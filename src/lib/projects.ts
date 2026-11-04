/** Shared vocab + input parsing for project planning. */

export const PROJECT_STATUSES = ["planning", "active", "on_hold", "done"] as const;
export const TASK_STATUSES = ["todo", "doing", "done"] as const;
export const TASK_PRIORITIES = ["low", "medium", "high"] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const isProjectStatus = (v: unknown): v is ProjectStatus =>
  typeof v === "string" && (PROJECT_STATUSES as readonly string[]).includes(v);
export const isTaskStatus = (v: unknown): v is TaskStatus =>
  typeof v === "string" && (TASK_STATUSES as readonly string[]).includes(v);
export const isTaskPriority = (v: unknown): v is TaskPriority =>
  typeof v === "string" && (TASK_PRIORITIES as readonly string[]).includes(v);

/**
 * Parse an optional date field from a request body.
 * undefined → leave unchanged, null/"" → clear, string → Date (or "invalid").
 */
export function parseDate(v: unknown): Date | null | undefined | "invalid" {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  if (typeof v !== "string") return "invalid";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "invalid" : d;
}

/** Trimmed non-empty string capped at `max`, or null. */
export function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

// ── UI vocab (safe to import from client components) ─────────────────────

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  planning: "Planning",
  active: "Active",
  on_hold: "On hold",
  done: "Done",
};

export const PROJECT_STATUS_STYLE: Record<ProjectStatus, string> = {
  planning: "bg-gh-chip text-gh-ink",
  active: "bg-teal-soft text-teal-dark",
  on_hold: "bg-amber-soft text-amber",
  done: "bg-green-soft text-green-deep",
};

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "To do",
  doing: "In progress",
  done: "Done",
};

export const PRIORITY_STYLE: Record<TaskPriority, string> = {
  low: "bg-chip text-muted",
  medium: "bg-wp-chip text-wp-ink",
  high: "bg-diff-del text-diff-del-line",
};

/** "2026-11-02T00:00:00.000Z" → "Nov 2" (adds the year when it isn't this year). */
export function formatDue(iso: string): string {
  const d = new Date(iso);
  const sameYear = d.getUTCFullYear() === new Date().getUTCFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  });
}

/** True when a due date (stored as UTC midnight) is before today. */
export function isOverdue(iso: string | null, done: boolean): boolean {
  if (!iso || done) return false;
  const today = new Date();
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return new Date(iso).getTime() < todayUtc;
}
