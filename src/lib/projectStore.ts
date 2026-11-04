import { prisma } from "./prisma";
import { audit } from "./audit";
import {
  cleanText,
  isProjectStatus,
  isTaskPriority,
  isTaskStatus,
  parseDate,
  type TaskStatus,
} from "./projects";

/**
 * Server-side project planning operations, shared by the REST API (the
 * Projects UI) and the MCP server so both validate input the same way.
 * Bad input throws ProjectError; callers map `status` to HTTP / tool errors.
 */

export class ProjectError extends Error {
  constructor(message: string, readonly status: 400 | 404 = 400) {
    super(message);
  }
}

const notFound = (what: string) => new ProjectError(`${what} not found`, 404);

function dateField(v: unknown, label: string): Date | null | undefined {
  const d = parseDate(v);
  if (d === "invalid") throw new ProjectError(`Invalid ${label} — use YYYY-MM-DD`);
  return d;
}

/** Start of today in UTC — due dates are stored as UTC midnight. */
function startOfTodayUtc(): number {
  const t = new Date();
  return Date.UTC(t.getFullYear(), t.getMonth(), t.getDate());
}

const touch = (projectId: string) =>
  prisma.project.update({ where: { id: projectId }, data: { updatedAt: new Date() } });

async function nextPosition(projectId: string, status: string): Promise<number> {
  const last = await prisma.projectTask.aggregate({
    where: { projectId, status },
    _max: { position: true },
  });
  return (last._max.position ?? -1) + 1;
}

// ── reads ────────────────────────────────────────────────────────────────

export async function listProjects(status?: string) {
  const projects = await prisma.project.findMany({
    where: isProjectStatus(status) ? { status } : {},
    orderBy: [{ updatedAt: "desc" }],
    include: {
      tasks: { select: { status: true, dueDate: true } },
      _count: { select: { documents: true } },
    },
  });
  const today = startOfTodayUtc();
  return projects.map(({ tasks, _count, ...p }) => ({
    ...p,
    taskCount: tasks.length,
    doneCount: tasks.filter((t) => t.status === "done").length,
    overdueCount: tasks.filter(
      (t) => t.status !== "done" && t.dueDate && t.dueDate.getTime() < today
    ).length,
    documentCount: _count.documents,
  }));
}

export async function getProject(id: string) {
  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      tasks: { orderBy: [{ position: "asc" }, { createdAt: "asc" }] },
      documents: {
        orderBy: { createdAt: "asc" },
        include: {
          document: {
            select: {
              id: true,
              title: true,
              kind: true,
              status: true,
              source: { select: { name: true, type: true } },
            },
          },
        },
      },
    },
  });
  if (!project) throw notFound("Project");
  const { documents, ...rest } = project;
  return { ...rest, documents: documents.map((d) => d.document) };
}

// ── projects ─────────────────────────────────────────────────────────────

export async function createProject(input: Record<string, unknown>, actor?: string) {
  const name = cleanText(input.name, 200);
  if (!name) throw new ProjectError("Project name is required");
  if (input.status !== undefined && !isProjectStatus(input.status)) {
    throw new ProjectError("Invalid project status — use planning, active, on_hold or done");
  }
  const dueDate = dateField(input.dueDate, "due date");

  const project = await prisma.project.create({
    data: {
      name,
      description: cleanText(input.description, 5000),
      status: isProjectStatus(input.status) ? input.status : "planning",
      dueDate: dueDate ?? null,
    },
  });
  await audit("project.created", `Project created: ${name}`, {
    entityType: "project",
    entityId: project.id,
    actor,
  });
  return project;
}

export async function updateProject(
  id: string,
  input: Record<string, unknown>,
  actor?: string
) {
  const existing = await prisma.project.findUnique({ where: { id } });
  if (!existing) throw notFound("Project");

  const data: { name?: string; description?: string | null; status?: string; dueDate?: Date | null } = {};
  if (input.name !== undefined) {
    const name = cleanText(input.name, 200);
    if (!name) throw new ProjectError("Project name is required");
    data.name = name;
  }
  if (input.description !== undefined) data.description = cleanText(input.description, 5000);
  if (input.status !== undefined) {
    if (!isProjectStatus(input.status)) {
      throw new ProjectError("Invalid project status — use planning, active, on_hold or done");
    }
    data.status = input.status;
  }
  const dueDate = dateField(input.dueDate, "due date");
  if (dueDate !== undefined) data.dueDate = dueDate;

  const project = await prisma.project.update({ where: { id }, data });
  if (data.status && data.status !== existing.status) {
    await audit(
      "project.updated",
      `Project "${project.name}" marked ${data.status.replace("_", " ")}`,
      {
        entityType: "project",
        entityId: id,
        actor,
        detail: { status: { from: existing.status, to: data.status } },
      }
    );
  }
  return project;
}

export async function deleteProject(id: string, actor?: string) {
  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) throw notFound("Project");
  await prisma.project.delete({ where: { id } });
  await audit("project.deleted", `Project deleted: ${project.name}`, {
    entityType: "project",
    entityId: id,
    actor,
  });
}

// ── tasks ────────────────────────────────────────────────────────────────

type TaskInput = Record<string, unknown>;

/** Validate a new task without writing it (so a batch can fail as a whole). */
export function parseNewTask(input: TaskInput) {
  const title = cleanText(input.title, 300);
  if (!title) throw new ProjectError("Task title is required");
  if (input.status !== undefined && !isTaskStatus(input.status)) {
    throw new ProjectError(`Invalid task status for "${title}" — use todo, doing or done`);
  }
  if (input.priority !== undefined && !isTaskPriority(input.priority)) {
    throw new ProjectError(`Invalid priority for "${title}" — use low, medium or high`);
  }
  return {
    title,
    notes: cleanText(input.notes, 5000),
    status: (isTaskStatus(input.status) ? input.status : "todo") as TaskStatus,
    priority: isTaskPriority(input.priority) ? input.priority : "medium",
    dueDate: dateField(input.dueDate, "task due date") ?? null,
  };
}

/** Append tasks to the end of their columns. All-or-nothing. */
export async function addTasks(projectId: string, inputs: TaskInput[]) {
  if (inputs.length === 0) throw new ProjectError("At least one task is required");
  if (inputs.length > 100) throw new ProjectError("Max 100 tasks per request");
  const parsed = inputs.map(parseNewTask);

  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) throw notFound("Project");

  const positions: Record<string, number> = {};
  for (const t of parsed) {
    positions[t.status] ??= await nextPosition(projectId, t.status);
  }
  const now = new Date();
  const tasks = await prisma.$transaction([
    ...parsed.map((t) =>
      prisma.projectTask.create({
        data: {
          ...t,
          projectId,
          position: positions[t.status]++,
          completedAt: t.status === "done" ? now : null,
        },
      })
    ),
    touch(projectId),
  ]);
  return tasks.slice(0, parsed.length) as Awaited<ReturnType<typeof prisma.projectTask.create>>[];
}

/**
 * Update a task. Pass projectId to require the task belongs to that project
 * (the REST route does; MCP addresses tasks by id alone).
 * Moving to another column appends it to the end of that column.
 */
export async function updateTask(taskId: string, input: TaskInput, projectId?: string) {
  const task = await prisma.projectTask.findFirst({
    where: { id: taskId, ...(projectId ? { projectId } : {}) },
  });
  if (!task) throw notFound("Task");

  const data: {
    title?: string;
    notes?: string | null;
    status?: string;
    priority?: string;
    dueDate?: Date | null;
    position?: number;
    completedAt?: Date | null;
  } = {};

  if (input.title !== undefined) {
    const title = cleanText(input.title, 300);
    if (!title) throw new ProjectError("Task title is required");
    data.title = title;
  }
  if (input.notes !== undefined) data.notes = cleanText(input.notes, 5000);
  if (input.priority !== undefined) {
    if (!isTaskPriority(input.priority)) {
      throw new ProjectError("Invalid priority — use low, medium or high");
    }
    data.priority = input.priority;
  }
  const dueDate = dateField(input.dueDate, "due date");
  if (dueDate !== undefined) data.dueDate = dueDate;

  if (input.status !== undefined) {
    if (!isTaskStatus(input.status)) {
      throw new ProjectError("Invalid task status — use todo, doing or done");
    }
    if (input.status !== task.status) {
      data.status = input.status;
      data.position = await nextPosition(task.projectId, input.status);
      data.completedAt = input.status === "done" ? new Date() : null;
    }
  }

  const [updated] = await prisma.$transaction([
    prisma.projectTask.update({ where: { id: taskId }, data }),
    touch(task.projectId),
  ]);
  return updated;
}

export async function deleteTask(taskId: string, projectId?: string) {
  const task = await prisma.projectTask.findFirst({
    where: { id: taskId, ...(projectId ? { projectId } : {}) },
    select: { id: true, title: true, projectId: true },
  });
  if (!task) throw notFound("Task");
  await prisma.projectTask.delete({ where: { id: taskId } });
  return task;
}

// ── document links ───────────────────────────────────────────────────────

/**
 * Link documents to a project (idempotent). `allowedSourceIds` limits which
 * documents may be linked — MCP passes its source scope.
 */
export async function linkDocuments(
  projectId: string,
  documentIds: string[],
  allowedSourceIds?: string[]
) {
  const ids = [...new Set(documentIds.filter((d) => typeof d === "string" && d))];
  if (ids.length === 0) throw new ProjectError("documentId is required");

  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) throw notFound("Project");

  const docs = await prisma.document.findMany({
    where: {
      id: { in: ids },
      ...(allowedSourceIds?.length ? { sourceId: { in: allowedSourceIds } } : {}),
    },
    select: { id: true, title: true },
  });
  if (docs.length !== ids.length) {
    const found = new Set(docs.map((d) => d.id));
    throw notFound(`Document ${ids.filter((i) => !found.has(i)).join(", ")}`);
  }

  await prisma.$transaction([
    ...docs.map((d) =>
      prisma.projectDocument.upsert({
        where: { projectId_documentId: { projectId, documentId: d.id } },
        create: { projectId, documentId: d.id },
        update: {},
      })
    ),
    touch(projectId),
  ]);
  return docs;
}

export async function unlinkDocument(projectId: string, documentId: string) {
  if (!documentId) throw new ProjectError("documentId is required");
  const { count } = await prisma.projectDocument.deleteMany({ where: { projectId, documentId } });
  return count > 0;
}

/** Map a thrown error to a JSON Response for the REST routes. */
export function projectErrorResponse(err: unknown): Response {
  if (err instanceof ProjectError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  throw err;
}
