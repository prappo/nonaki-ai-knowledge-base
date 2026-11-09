import type { McpConfig } from "./share";
import {
  ProjectError,
  addTasks,
  createProject,
  deleteTask,
  getProject,
  linkDocuments,
  listProjects,
  parseNewTask,
  unlinkDocument,
  updateProject,
  updateTask,
} from "./projectStore";
import { PROJECT_STATUSES, TASK_PRIORITIES, TASK_STATUSES } from "./projects";

/**
 * Project-planning tools for the MCP server. Gated by McpConfig.projectAccess:
 * "read" exposes list/get, "write" adds create/update/task/link tools.
 * Every write is audited with actor "mcp".
 */

const ACTOR = "mcp";

type ToolResult = { content: { type: "text"; text: string }[]; isError: boolean };
const text = (t: string, isError = false): ToolResult => ({
  content: [{ type: "text", text: t }],
  isError,
});
const json = (v: unknown) => text(JSON.stringify(v, null, 2));

const DATE = { type: "string", description: "Date as YYYY-MM-DD, or null to clear" };

const TASK_FIELDS = {
  title: { type: "string", description: "Short task title" },
  notes: { type: "string", description: "Optional details / acceptance criteria" },
  status: { type: "string", enum: TASK_STATUSES, description: "Board column (default todo)" },
  priority: { type: "string", enum: TASK_PRIORITIES, description: "Default medium" },
  dueDate: DATE,
  assignee: {
    type: ["string", "null"],
    description: "Email of the app user to assign it to, or null to unassign",
  },
};

const READ_TOOLS = [
  {
    name: "list_projects",
    description:
      "List planning projects with status, due date and task progress " +
      "(taskCount, doneCount, overdueCount). Use get_project for the tasks themselves.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: PROJECT_STATUSES, description: "Only this status" },
      },
    },
  },
  {
    name: "get_project",
    description:
      "Get one project: details, every task grouped by board column " +
      "(todo / doing / done) with ids, and the knowledge-base documents linked to it.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" } },
      required: ["projectId"],
    },
  },
];

const WRITE_TOOLS = [
  {
    name: "create_project",
    description:
      "Create a planning project, optionally with an initial task breakdown. " +
      "Tip: search_knowledge_base first and link the relevant docs with link_documents.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        description: { type: "string", description: "Goal / scope of the project" },
        status: { type: "string", enum: PROJECT_STATUSES, description: "Default planning" },
        dueDate: DATE,
        tasks: {
          type: "array",
          description: "Initial tasks, in order",
          items: { type: "object", properties: TASK_FIELDS, required: ["title"] },
        },
      },
      required: ["name"],
    },
  },
  {
    name: "update_project",
    description: "Change a project's name, description, status or due date. Omitted fields are left as is.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        status: { type: "string", enum: PROJECT_STATUSES },
        dueDate: DATE,
      },
      required: ["projectId"],
    },
  },
  {
    name: "add_tasks",
    description: "Add one or more tasks to a project (appended to the end of their column). All-or-nothing.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        tasks: {
          type: "array",
          minItems: 1,
          items: { type: "object", properties: TASK_FIELDS, required: ["title"] },
        },
      },
      required: ["projectId", "tasks"],
    },
  },
  {
    name: "update_task",
    description:
      "Update a task by id: rename it, edit notes, change priority, due date or assignee, " +
      "or move it between columns with status (todo → doing → done).",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: "object",
      properties: { taskId: { type: "string" }, ...TASK_FIELDS },
      required: ["taskId"],
    },
  },
  {
    name: "delete_task",
    description: "Permanently delete one task by id.",
    annotations: { readOnlyHint: false, destructiveHint: true },
    inputSchema: {
      type: "object",
      properties: { taskId: { type: "string" } },
      required: ["taskId"],
    },
  },
  {
    name: "link_documents",
    description:
      "Link knowledge-base documents (ids from search_knowledge_base / ask_knowledge_base) " +
      "to a project as reference material. Already-linked documents are ignored.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        documentIds: { type: "array", items: { type: "string" }, minItems: 1 },
      },
      required: ["projectId", "documentIds"],
    },
  },
  {
    name: "unlink_document",
    description: "Remove a document link from a project (the document itself is kept).",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" }, documentId: { type: "string" } },
      required: ["projectId", "documentId"],
    },
  },
];

const WRITE_NAMES = new Set(WRITE_TOOLS.map((t) => t.name));
const ALL_NAMES = new Set([...READ_TOOLS, ...WRITE_TOOLS].map((t) => t.name));

export function projectTools(config: McpConfig) {
  if (config.projectAccess === "off") return [];
  if (config.projectAccess === "read") return READ_TOOLS;
  return [...READ_TOOLS, ...WRITE_TOOLS];
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const asArray = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : [];

/** Fields of `args` other than the listed id keys (so they aren't treated as updates). */
function fieldsOf(args: Record<string, unknown>, ...omit: string[]) {
  return Object.fromEntries(Object.entries(args).filter(([k]) => !omit.includes(k)));
}

/** Compact board view for get_project / create_project results. */
async function projectView(id: string) {
  const p = await getProject(id);
  const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
  const column = (status: string) =>
    p.tasks
      .filter((t) => t.status === status)
      .map((t) => ({
        id: t.id,
        title: t.title,
        priority: t.priority,
        dueDate: day(t.dueDate),
        assignee: t.assignee,
        ...(t.notes ? { notes: t.notes } : {}),
      }));
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    status: p.status,
    dueDate: day(p.dueDate),
    tasks: { todo: column("todo"), doing: column("doing"), done: column("done") },
    linkedDocuments: p.documents.map((d) => ({ id: d.id, title: d.title, source: d.source.name })),
  };
}

/**
 * Run a project tool. Returns null when `name` isn't a project tool (so the
 * caller can fall through), and a tool error when access doesn't allow it.
 */
export async function callProjectTool(
  config: McpConfig,
  name: string,
  args: Record<string, unknown>
): Promise<ToolResult | null> {
  if (!ALL_NAMES.has(name)) return null;
  if (config.projectAccess === "off") {
    return text("Project tools are disabled for this MCP server.", true);
  }
  if (WRITE_NAMES.has(name) && config.projectAccess !== "write") {
    return text("This MCP server has read-only access to projects.", true);
  }

  try {
    switch (name) {
      case "list_projects": {
        const projects = await listProjects(str(args.status) || undefined);
        if (projects.length === 0) return text("No projects yet.");
        return json(
          projects.map((p) => ({
            id: p.id,
            name: p.name,
            status: p.status,
            dueDate: p.dueDate?.toISOString().slice(0, 10) ?? null,
            taskCount: p.taskCount,
            doneCount: p.doneCount,
            overdueCount: p.overdueCount,
            documentCount: p.documentCount,
          }))
        );
      }
      case "get_project":
        return json(await projectView(str(args.projectId)));

      case "create_project": {
        const tasks = asArray(args.tasks);
        tasks.forEach(parseNewTask); // validate before writing anything
        const project = await createProject(fieldsOf(args, "tasks"), ACTOR);
        if (tasks.length) await addTasks(project.id, tasks);
        return json(await projectView(project.id));
      }
      case "update_project": {
        const p = await updateProject(str(args.projectId), fieldsOf(args, "projectId"), ACTOR);
        return text(`Updated project "${p.name}" (status: ${p.status}).`);
      }
      case "add_tasks": {
        const created = await addTasks(str(args.projectId), asArray(args.tasks));
        return json(created.map((t) => ({ id: t.id, title: t.title, status: t.status })));
      }
      case "update_task": {
        const t = await updateTask(str(args.taskId), fieldsOf(args, "taskId"));
        return text(`Updated task "${t.title}" (status: ${t.status}, priority: ${t.priority}).`);
      }
      case "delete_task": {
        const t = await deleteTask(str(args.taskId));
        return text(`Deleted task "${t.title}".`);
      }
      case "link_documents": {
        const ids = Array.isArray(args.documentIds) ? args.documentIds.map(str) : [];
        // respect the MCP source scope — out-of-scope docs read as "not found"
        const docs = await linkDocuments(str(args.projectId), ids, config.sourceIds);
        return text(`Linked ${docs.length} document(s): ${docs.map((d) => d.title).join("; ")}`);
      }
      case "unlink_document": {
        const removed = await unlinkDocument(str(args.projectId), str(args.documentId));
        return text(removed ? "Document unlinked." : "That document wasn't linked to the project.");
      }
    }
  } catch (err) {
    if (err instanceof ProjectError) return text(err.message, true);
    throw err;
  }
  return null;
}
