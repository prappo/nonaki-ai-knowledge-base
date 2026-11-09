import { prisma } from "./prisma";
import { audit } from "./audit";
import { isEmail, listUsers } from "./users";
import {
  cleanText,
  isProjectStatus,
  isTaskPriority,
  isTaskStatus,
  parseDate,
  type TaskStatus,
} from "./projects";
import type { Prisma } from "@/generated/prisma/client";

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

/** Bump the project's updatedAt, when the task has one. */
const touchAll = (...projectIds: (string | null)[]) =>
  [...new Set(projectIds.filter((p): p is string => Boolean(p)))].map(touch);

/** Standalone tasks (projectId null) keep their own column order. */
async function nextPosition(projectId: string | null, status: string): Promise<number> {
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
    assignee: assigneeField(input.assignee) ?? null,
  };
}

/** undefined → leave unchanged, null/"" → unassign, email → that user (lowercased). */
function assigneeField(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  if (!isEmail(v)) throw new ProjectError("Invalid assignee — use the user's email");
  return v.toLowerCase();
}

/** Refuse emails that aren't app users (skipped when the user list can't be read). */
async function requireKnownUsers(emails: (string | null | undefined)[]) {
  const wanted = [...new Set(emails.filter((e): e is string => Boolean(e)))];
  if (wanted.length === 0) return;
  const users = await listUsers();
  if (users.length === 0) return;
  const known = new Set(users.map((u) => u.email));
  const missing = wanted.filter((e) => !known.has(e));
  if (missing.length) throw new ProjectError(`No user with the email ${missing.join(", ")}`);
}

/** undefined → leave unchanged, null/"" → no project, id → that project (must exist). */
async function projectField(v: unknown): Promise<string | null | undefined> {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  if (typeof v !== "string") throw new ProjectError("Invalid projectId");
  const project = await prisma.project.findUnique({ where: { id: v }, select: { id: true } });
  if (!project) throw notFound("Project");
  return project.id;
}

/** Append tasks to the end of their project's columns. All-or-nothing. */
export async function addTasks(projectId: string, inputs: TaskInput[], actor?: string) {
  if (inputs.length === 0) throw new ProjectError("At least one task is required");
  if (inputs.length > 100) throw new ProjectError("Max 100 tasks per request");
  const parsed = inputs.map(parseNewTask);
  await requireKnownUsers(parsed.map((t) => t.assignee));

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
          createdBy: actor ?? null,
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
export async function updateTask(
  taskId: string,
  input: TaskInput,
  projectId?: string,
  actor?: string
) {
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
    assignee?: string | null;
    projectId?: string | null;
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

  const assignee = assigneeField(input.assignee);
  if (assignee !== undefined && assignee !== task.assignee) {
    await requireKnownUsers([assignee]);
    data.assignee = assignee;
  }

  const targetProject = await projectField(input.projectId);
  if (targetProject !== undefined && targetProject !== task.projectId) {
    data.projectId = targetProject;
  }

  if (input.status !== undefined) {
    if (!isTaskStatus(input.status)) {
      throw new ProjectError("Invalid task status — use todo, doing or done");
    }
    if (input.status !== task.status) {
      data.status = input.status;
      data.completedAt = input.status === "done" ? new Date() : null;
    }
  }
  // a new column or a new project puts the task at the end of its column
  if (data.status !== undefined || data.projectId !== undefined) {
    data.position = await nextPosition(
      data.projectId !== undefined ? data.projectId : task.projectId,
      data.status ?? task.status
    );
  }

  const [updated] = await prisma.$transaction([
    prisma.projectTask.update({ where: { id: taskId }, data, include: TASK_INCLUDE }),
    ...touchAll(task.projectId, data.projectId ?? null),
  ]);

  if (data.assignee !== undefined) {
    await audit(
      "task.assigned",
      data.assignee
        ? `Task "${updated.title}" assigned to ${data.assignee}`
        : `Task "${updated.title}" unassigned`,
      {
        entityType: "task",
        entityId: taskId,
        actor,
        detail: { assignee: { from: task.assignee, to: data.assignee } },
      }
    );
  }
  return updated;
}

const TASK_INCLUDE = { project: { select: { id: true, name: true, status: true } } } as const;

/** Create one task from the Tasks page: optionally on a project, optionally assigned. */
export async function createTask(input: TaskInput, actor?: string) {
  const parsed = parseNewTask(input);
  const projectId = (await projectField(input.projectId)) ?? null;
  await requireKnownUsers([parsed.assignee]);

  const [task] = await prisma.$transaction([
    prisma.projectTask.create({
      data: {
        ...parsed,
        projectId,
        createdBy: actor ?? null,
        position: await nextPosition(projectId, parsed.status),
        completedAt: parsed.status === "done" ? new Date() : null,
      },
      include: TASK_INCLUDE,
    }),
    ...touchAll(projectId),
  ]);
  return task;
}

export type TaskFilters = {
  /** "me", "unassigned", an email, or empty for everyone */
  assignee?: string | null;
  /** "open" (to do + in progress, the default), a status, or "all" */
  status?: string | null;
  /** a project id, "none" for standalone tasks, or empty for any */
  project?: string | null;
  priority?: string | null;
  /** "overdue", "today", "week" (next 7 days) or "none" (no due date) */
  due?: string | null;
  q?: string | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function taskWhere(f: TaskFilters, me: string | null): Prisma.ProjectTaskWhereInput {
  const where: Prisma.ProjectTaskWhereInput = {};
  const and: Prisma.ProjectTaskWhereInput[] = [];

  if (f.assignee === "me") where.assignee = me ?? "__nobody__";
  else if (f.assignee === "unassigned") where.assignee = null;
  else if (f.assignee) where.assignee = f.assignee.toLowerCase();

  const status = f.status || "open";
  if (status === "open") where.status = { in: ["todo", "doing"] };
  else if (isTaskStatus(status)) where.status = status;

  if (f.project === "none") where.projectId = null;
  else if (f.project) where.projectId = f.project;

  if (isTaskPriority(f.priority)) where.priority = f.priority;

  const today = startOfTodayUtc();
  if (f.due === "overdue") {
    and.push({ dueDate: { lt: new Date(today) } }, { status: { not: "done" } });
  } else if (f.due === "today") {
    where.dueDate = { gte: new Date(today), lt: new Date(today + DAY_MS) };
  } else if (f.due === "week") {
    where.dueDate = { gte: new Date(today), lt: new Date(today + 7 * DAY_MS) };
  } else if (f.due === "none") {
    where.dueDate = null;
  }

  const q = f.q?.trim();
  if (q) {
    and.push({
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { notes: { contains: q, mode: "insensitive" } },
      ],
    });
  }
  if (and.length) where.AND = and;
  return where;
}

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

/**
 * Tasks across every project (and standalone ones) for the Tasks page:
 * soonest due first, undated last, high priority first within a day.
 * Done tasks list the most recently finished first.
 */
export async function listTasks(filters: TaskFilters, me: string | null, limit = 500) {
  const tasks = await prisma.projectTask.findMany({
    where: taskWhere(filters, me),
    include: TASK_INCLUDE,
    orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    take: limit + 1,
  });
  const truncated = tasks.length > limit;
  const shown = tasks.slice(0, limit);

  shown.sort((a, b) => {
    if (a.status === "done" && b.status === "done") {
      return (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0);
    }
    const da = a.dueDate?.getTime() ?? Infinity;
    const db = b.dueDate?.getTime() ?? Infinity;
    if (da !== db) return da - db;
    return (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1);
  });
  return { tasks: shown, truncated };
}

/** Open-task counts for the Tasks page tabs. */
export async function taskCounts(me: string | null) {
  const open = { status: { in: ["todo", "doing"] } };
  const [mine, all, unassigned, overdue] = await Promise.all([
    me ? prisma.projectTask.count({ where: { ...open, assignee: me } }) : Promise.resolve(0),
    prisma.projectTask.count({ where: open }),
    prisma.projectTask.count({ where: { ...open, assignee: null } }),
    prisma.projectTask.count({
      where: { ...open, dueDate: { lt: new Date(startOfTodayUtc()) } },
    }),
  ]);
  return { mine, all, unassigned, overdue };
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
