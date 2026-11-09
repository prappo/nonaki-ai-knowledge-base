"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { TopStrip } from "@/components/Shell";
import { Icon } from "@/components/Icons";
import { ListRowsSkeleton } from "@/components/Skeleton";
import { FilterSelect } from "@/components/FilterSelect";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { AssigneePicker, displayName, useUsers, type AppUser } from "@/components/TaskBits";
import {
  PRIORITY_STYLE,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_STATUS_LABEL,
  formatDue,
  isOverdue,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/projects";

type Task = {
  id: string;
  title: string;
  notes: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  assignee: string | null;
  createdBy: string | null;
  createdAt: string;
  completedAt: string | null;
  projectId: string | null;
  project: { id: string; name: string; status: string } | null;
};

type ProjectOption = { id: string; name: string; status: string };
type Counts = { mine: number; all: number; unassigned: number; overdue: number };

type Tab = "mine" | "all" | "unassigned" | "overdue";
type StatusFilter = "open" | TaskStatus | "all";
type View = "list" | "board";

const TABS: { id: Tab; label: string }[] = [
  { id: "mine", label: "My tasks" },
  { id: "all", label: "All tasks" },
  { id: "unassigned", label: "Unassigned" },
  { id: "overdue", label: "Overdue" },
];

const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "todo", label: "To do" },
  { id: "doing", label: "In progress" },
  { id: "done", label: "Done" },
  { id: "all", label: "All" },
];

// ── remembered tab + view (per browser) ─────────────────────────────────

const PREFS_KEY = "nonaki:tasks-view";
const prefListeners = new Set<() => void>();

function readPrefsRaw(): string {
  try {
    return localStorage.getItem(PREFS_KEY) ?? "";
  } catch {
    return ""; // private window / blocked storage
  }
}

function parsePrefs(raw: string): { tab: Tab; view: View } {
  try {
    const p = JSON.parse(raw || "{}");
    return {
      tab: TABS.some((t) => t.id === p.tab) ? p.tab : "mine",
      view: p.view === "board" ? "board" : "list",
    };
  } catch {
    return { tab: "mine", view: "list" };
  }
}

function writePrefs(patch: Partial<{ tab: Tab; view: View }>) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...parsePrefs(readPrefsRaw()), ...patch }));
  } catch {
    // not remembered — still notify so this tab updates
  }
  prefListeners.forEach((l) => l());
}

/** The remembered tab and view; the server render uses the defaults. */
function usePrefs() {
  const raw = useSyncExternalStore(
    (cb) => {
      prefListeners.add(cb);
      return () => prefListeners.delete(cb);
    },
    readPrefsRaw,
    () => ""
  );
  return useMemo(() => parsePrefs(raw), [raw]);
}

/** ISO → value for <input type="date"> */
const toDateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

const DAY = 24 * 60 * 60 * 1000;

/** Which list group a task falls into, by due date (stored as UTC midnight). */
function dueBucket(task: Task): { id: string; label: string } {
  if (task.status === "done") return { id: "done", label: "Done" };
  if (!task.dueDate) return { id: "none", label: "No due date" };
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const due = new Date(task.dueDate).getTime();
  if (due < today) return { id: "overdue", label: "Overdue" };
  if (due < today + DAY) return { id: "today", label: "Today" };
  if (due < today + 2 * DAY) return { id: "tomorrow", label: "Tomorrow" };
  if (due < today + 7 * DAY) return { id: "week", label: "Next 7 days" };
  return { id: "later", label: "Later" };
}

const BUCKET_ORDER = ["overdue", "today", "tomorrow", "week", "later", "none", "done"];

export default function TasksPage() {
  const { users, me } = useUsers();
  const { tab, view } = usePrefs();
  const setTab = (t: Tab) => writePrefs({ tab: t });
  const setView = (v: View) => writePrefs({ view: v });
  const [status, setStatus] = useState<StatusFilter>("open");
  const [project, setProject] = useState("");
  const [priority, setPriority] = useState("");
  const [due, setDue] = useState("");
  const [query, setQuery] = useState("");
  const [q, setQ] = useState(""); // debounced query

  const [tasks, setTasks] = useState<Task[]>([]);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [truncated, setTruncated] = useState(false);
  // which filter set the shown tasks answer — loading until it matches
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQ(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setProjects(d.projects ?? []))
      .catch(() => {});
  }, []);

  // the board shows every column, so it ignores the status filter
  const effectiveStatus: StatusFilter = view === "board" ? "all" : status;

  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (tab === "mine") p.set("assignee", "me");
    if (tab === "unassigned") p.set("assignee", "unassigned");
    if (tab === "overdue") p.set("due", "overdue");
    else if (due) p.set("due", due);
    p.set("status", tab === "overdue" ? "open" : effectiveStatus);
    if (project) p.set("project", project);
    if (priority) p.set("priority", priority);
    if (q) p.set("q", q);
    return p.toString();
  }, [tab, due, effectiveStatus, project, priority, q]);

  const requestId = useRef(0);
  const load = useCallback(() => {
    const id = ++requestId.current;
    return fetch(`/api/tasks?${params}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Could not load tasks"))))
      .then((d) => {
        if (id !== requestId.current) return; // a newer filter won
        setTasks(d.tasks ?? []);
        setCounts(d.counts ?? null);
        setTruncated(Boolean(d.truncated));
        setLoadedKey(params);
      })
      .catch((e: Error) => {
        if (id !== requestId.current) return;
        setError(e.message);
        setLoadedKey(params);
      });
  }, [params]);

  useEffect(() => {
    load();
  }, [load]);

  const loaded = loadedKey === params;

  /** Send a JSON request; on failure show the error and reload server state. */
  async function send(url: string, method: string, body?: unknown) {
    setError(null);
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(d.error ?? "Something went wrong");
      load();
      return null;
    }
    return d;
  }

  async function updateTask(id: string, patch: Partial<Task>) {
    const project =
      patch.projectId !== undefined
        ? projects.find((p) => p.id === patch.projectId) ?? null
        : undefined;
    setTasks((ts) =>
      ts.map((t) =>
        t.id === id ? { ...t, ...patch, ...(project !== undefined ? { project } : {}) } : t
      )
    );
    const d = await send(`/api/tasks/${id}`, "PATCH", patch);
    if (d?.task) {
      setTasks((ts) => ts.map((t) => (t.id === id ? d.task : t)));
      // counts (and which tasks match the filters) may have changed
      refreshCounts();
    }
  }

  async function createTask(input: Record<string, unknown>) {
    const d = await send("/api/tasks", "POST", input);
    if (d?.task) {
      setTasks((ts) => [...ts, d.task]);
      refreshCounts();
    }
    return Boolean(d?.task);
  }

  async function deleteTask(id: string) {
    setTasks((ts) => ts.filter((t) => t.id !== id));
    setOpenId(null);
    await send(`/api/tasks/${id}`, "DELETE");
    refreshCounts();
  }

  function refreshCounts() {
    fetch(`/api/tasks?${params}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.counts && setCounts(d.counts))
      .catch(() => {});
  }

  const openTask = tasks.find((t) => t.id === openId) ?? null;
  const overdueOpen = counts?.overdue ?? 0;

  // a new task inherits what the page is filtered to
  const defaults = {
    assignee: tab === "mine" ? me : null,
    projectId: project && project !== "none" ? project : null,
    status: (view === "list" && (status === "todo" || status === "doing") ? status : "todo") as TaskStatus,
  };

  const projectOptions = [
    { value: "", label: "All projects" },
    { value: "none", label: "No project" },
    ...projects.map((p) => ({ value: p.id, label: p.name })),
  ];

  const filtered = Boolean(project || priority || (due && tab !== "overdue") || q);

  return (
    <>
      <TopStrip
        crumb="Nonaki / Tasks"
        right={
          <span className={overdueOpen > 0 ? "text-diff-del-line" : ""}>
            {counts ? `${counts.all} OPEN · ${overdueOpen} OVERDUE` : "…"}
          </span>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin p-7">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-baseline gap-2.5">
            <h1 className="text-[21px] font-semibold tracking-[-0.01em]">Tasks</h1>
            <span className="text-xs text-muted">everything to do, across every project</span>
          </div>
          <div className="ml-auto flex rounded-full border border-edge bg-card p-0.5">
            {(["list", "board"] as View[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`rounded-full px-3 py-1 text-[11px] ${
                  view === v ? "bg-teal-soft font-semibold text-teal-dark" : "text-muted hover:text-ink"
                }`}
              >
                {v === "list" ? "List" : "Board"}
              </button>
            ))}
          </div>
        </div>

        {/* tabs */}
        <div className="mt-4 flex flex-wrap gap-1 border-b border-hairline">
          {TABS.map((t) => {
            const n = counts?.[t.id === "all" ? "all" : t.id];
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[12.5px] ${
                  tab === t.id
                    ? "border-teal font-semibold text-ink"
                    : "border-transparent text-muted hover:text-ink"
                }`}
              >
                {t.label}
                {n !== undefined && (
                  <span
                    className={`rounded-full px-1.5 font-mono text-[9.5px] ${
                      t.id === "overdue" && n > 0
                        ? "bg-diff-del text-diff-del-line"
                        : "bg-chip text-muted"
                    }`}
                  >
                    {n}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* filters */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {view === "list" && tab !== "overdue" && (
            <div className="flex flex-wrap gap-1">
              {STATUS_FILTERS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setStatus(s.id)}
                  className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                    status === s.id
                      ? "border-transparent bg-teal-soft font-semibold text-teal-dark"
                      : "border-edge bg-card text-muted hover:border-teal hover:text-teal"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
          <FilterSelect options={projectOptions} value={project} onChange={setProject} width="w-60" />
          <FilterSelect
            options={[
              { value: "", label: "Any priority" },
              ...TASK_PRIORITIES.map((p) => ({ value: p, label: p[0].toUpperCase() + p.slice(1) })),
            ]}
            value={priority}
            onChange={setPriority}
            width="w-36"
          />
          {tab !== "overdue" && (
            <FilterSelect
              options={[
                { value: "", label: "Any due date" },
                { value: "overdue", label: "Overdue" },
                { value: "today", label: "Due today" },
                { value: "week", label: "Due in 7 days" },
                { value: "none", label: "No due date" },
              ]}
              value={due}
              onChange={setDue}
              width="w-40"
            />
          )}
          {filtered && (
            <button
              onClick={() => {
                setProject("");
                setPriority("");
                setDue("");
                setQuery("");
              }}
              className="text-[11px] text-muted hover:text-teal"
            >
              Clear filters
            </button>
          )}
          <label className="ml-auto flex w-60 items-center gap-2 rounded-full border border-edge bg-card px-3 py-1 focus-within:border-teal">
            <Icon name="ask" size={12} className="flex-none text-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search tasks…"
              className="w-full bg-transparent text-[11.5px] outline-none placeholder:text-faint"
            />
          </label>
        </div>

        {error && (
          <div className="mt-3 rounded-lg border border-warn-line bg-warn-bg px-3 py-2 text-[11.5px] text-warn-text">
            {error}
          </div>
        )}

        <QuickAdd
          key={`${defaults.assignee}-${defaults.projectId}-${defaults.status}`}
          defaults={defaults}
          users={users}
          me={me}
          projects={projects}
          onCreate={createTask}
        />

        {!loaded ? (
          <div className="mt-4 overflow-hidden rounded-xl border border-line bg-card">
            <ListRowsSkeleton rows={6} />
          </div>
        ) : view === "list" ? (
          <TaskList
            tasks={tasks}
            users={users}
            me={me}
            empty={emptyMessage(tab, status, filtered)}
            onOpen={setOpenId}
            onUpdate={updateTask}
          />
        ) : (
          <TaskBoard tasks={tasks} users={users} me={me} onOpen={setOpenId} onUpdate={updateTask} />
        )}

        {truncated && (
          <p className="mt-3 text-[11px] text-muted">
            Showing the first 500 tasks — narrow the filters to see the rest.
          </p>
        )}
      </div>

      {openTask && (
        <TaskDrawer
          key={openTask.id}
          task={openTask}
          users={users}
          me={me}
          projects={projects}
          onClose={() => setOpenId(null)}
          onUpdate={(patch) => updateTask(openTask.id, patch)}
          onDelete={() => deleteTask(openTask.id)}
        />
      )}
    </>
  );
}

function emptyMessage(tab: Tab, status: StatusFilter, filtered: boolean): string {
  if (filtered) return "No tasks match these filters.";
  if (tab === "overdue") return "Nothing overdue. Nice.";
  if (status === "done") return "No finished tasks yet.";
  if (tab === "mine") return "Nothing assigned to you. Add a task above, or pick one up from Unassigned.";
  if (tab === "unassigned") return "Every open task has an owner.";
  return "No tasks yet. Add one above.";
}

// ── quick add ────────────────────────────────────────────────────────────

function QuickAdd({
  defaults,
  users,
  me,
  projects,
  onCreate,
}: {
  defaults: { assignee: string | null; projectId: string | null; status: TaskStatus };
  users: AppUser[];
  me: string | null;
  projects: ProjectOption[];
  onCreate: (input: Record<string, unknown>) => Promise<boolean>;
}) {
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState(defaults.assignee);
  const [projectId, setProjectId] = useState(defaults.projectId ?? "");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    const ok = await onCreate({
      title: title.trim(),
      assignee,
      projectId: projectId || null,
      dueDate: dueDate || null,
      priority,
      status: defaults.status,
    });
    setBusy(false);
    if (ok) {
      setTitle("");
      setDueDate("");
      setPriority("medium");
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-card px-3 py-2 focus-within:border-teal"
    >
      <Icon name="plus" size={14} className="flex-none text-faint" />
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Add a task…"
        className="min-w-[180px] flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-faint"
      />
      <select
        value={projectId}
        onChange={(e) => setProjectId(e.target.value)}
        className="max-w-[170px] rounded-md border border-line bg-card px-1.5 py-1 text-[11px] text-slate outline-none focus:border-teal"
        aria-label="Project"
      >
        <option value="">No project</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <select
        value={priority}
        onChange={(e) => setPriority(e.target.value as TaskPriority)}
        className="rounded-md border border-line bg-card px-1.5 py-1 text-[11px] text-slate outline-none focus:border-teal"
        aria-label="Priority"
      >
        {TASK_PRIORITIES.map((p) => (
          <option key={p} value={p}>
            {p[0].toUpperCase() + p.slice(1)}
          </option>
        ))}
      </select>
      <input
        type="date"
        value={dueDate}
        onChange={(e) => setDueDate(e.target.value)}
        className="rounded-md border border-line bg-card px-1.5 py-0.5 text-[11px] text-slate outline-none focus:border-teal"
        aria-label="Due date"
      />
      <AssigneePicker value={assignee} users={users} me={me} onChange={setAssignee} align="right" />
      <button
        type="submit"
        disabled={!title.trim() || busy}
        className="rounded-md bg-teal px-3 py-1.5 text-[11.5px] font-semibold text-white hover:bg-teal-dark disabled:opacity-40"
      >
        {busy ? "Adding…" : "Add"}
      </button>
    </form>
  );
}

// ── list view ────────────────────────────────────────────────────────────

function TaskList({
  tasks,
  users,
  me,
  empty,
  onOpen,
  onUpdate,
}: {
  tasks: Task[];
  users: AppUser[];
  me: string | null;
  empty: string;
  onOpen: (id: string) => void;
  onUpdate: (id: string, patch: Partial<Task>) => void;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, { label: string; tasks: Task[] }>();
    for (const t of tasks) {
      const b = dueBucket(t);
      if (!map.has(b.id)) map.set(b.id, { label: b.label, tasks: [] });
      map.get(b.id)!.tasks.push(t);
    }
    return BUCKET_ORDER.filter((id) => map.has(id)).map((id) => ({ id, ...map.get(id)! }));
  }, [tasks]);

  if (tasks.length === 0) {
    return (
      <div className="mt-4 rounded-xl border border-dashed border-edge px-6 py-10 text-center text-[12.5px] text-muted">
        {empty}
      </div>
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-4">
      {groups.map((g) => (
        <section key={g.id}>
          <div
            className={`mb-1.5 flex items-center gap-2 font-mono text-[10px] tracking-[0.08em] ${
              g.id === "overdue" ? "text-diff-del-line" : "text-muted"
            }`}
          >
            {g.label.toUpperCase()} · {g.tasks.length}
          </div>
          <div className="overflow-hidden rounded-xl border border-line bg-card">
            {g.tasks.map((t, i) => (
              <TaskRow
                key={t.id}
                task={t}
                users={users}
                me={me}
                last={i === g.tasks.length - 1}
                onOpen={() => onOpen(t.id)}
                onUpdate={(patch) => onUpdate(t.id, patch)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function DoneToggle({ task, onUpdate }: { task: Task; onUpdate: (patch: Partial<Task>) => void }) {
  const isDone = task.status === "done";
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onUpdate({ status: isDone ? "todo" : "done" });
      }}
      title={isDone ? "Mark as not done" : "Mark as done"}
      aria-label={isDone ? "Mark as not done" : "Mark as done"}
      className={`grid h-4 w-4 flex-none place-items-center rounded border ${
        isDone ? "border-green bg-green text-white" : "border-ghost hover:border-teal"
      }`}
    >
      {isDone && <Icon name="check" size={10} />}
    </button>
  );
}

function TaskMeta({ task, showStatus }: { task: Task; showStatus: boolean }) {
  const isDone = task.status === "done";
  const late = isOverdue(task.dueDate, isDone);
  return (
    <>
      {showStatus && task.status === "doing" && (
        <span className="rounded bg-teal-soft px-1.5 py-px font-mono text-[9px] uppercase text-teal-dark">
          In progress
        </span>
      )}
      <span
        className={`rounded px-1.5 py-px font-mono text-[9px] uppercase ${PRIORITY_STYLE[task.priority]}`}
      >
        {task.priority}
      </span>
      {task.dueDate && (
        <span className={`font-mono text-[9.5px] ${late ? "text-diff-del-line" : "text-faint"}`}>
          {late ? "OVERDUE · " : ""}
          {formatDue(task.dueDate).toUpperCase()}
        </span>
      )}
      {task.project && (
        <Link
          href={`/projects/${task.project.id}`}
          onClick={(e) => e.stopPropagation()}
          className="flex max-w-[180px] items-center gap-1 truncate rounded bg-chip px-1.5 py-px text-[10.5px] text-muted hover:text-teal"
        >
          <Icon name="projects" size={10} />
          <span className="truncate">{task.project.name}</span>
        </Link>
      )}
      {task.notes && (
        <span className="font-mono text-[9.5px] text-faint" title="Has notes">
          ¶
        </span>
      )}
    </>
  );
}

function TaskRow({
  task,
  users,
  me,
  last,
  onOpen,
  onUpdate,
}: {
  task: Task;
  users: AppUser[];
  me: string | null;
  last: boolean;
  onOpen: () => void;
  onUpdate: (patch: Partial<Task>) => void;
}) {
  const isDone = task.status === "done";
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}
      className={`flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-hover ${
        last ? "" : "border-b border-hairline-2"
      }`}
    >
      <DoneToggle task={task} onUpdate={onUpdate} />
      <div className="min-w-0 flex-1">
        <div className={`truncate text-[12.5px] ${isDone ? "text-faint line-through" : ""}`}>
          {task.title}
        </div>
      </div>
      <div className="flex flex-none items-center gap-1.5">
        <TaskMeta task={task} showStatus />
      </div>
      <AssigneePicker
        value={task.assignee}
        users={users}
        me={me}
        compact
        align="right"
        onChange={(assignee) => onUpdate({ assignee })}
      />
    </div>
  );
}

// ── board view ───────────────────────────────────────────────────────────

function TaskBoard({
  tasks,
  users,
  me,
  onOpen,
  onUpdate,
}: {
  tasks: Task[];
  users: AppUser[];
  me: string | null;
  onOpen: (id: string) => void;
  onUpdate: (id: string, patch: Partial<Task>) => void;
}) {
  return (
    <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
      {TASK_STATUSES.map((status) => {
        const column = tasks.filter((t) => t.status === status);
        return (
          <div key={status} className="flex min-h-[160px] flex-col rounded-xl border border-line bg-panel">
            <div className="flex items-center gap-2 border-b border-hairline px-3.5 py-2.5">
              <span
                className={`h-2 w-2 rounded-full ${
                  status === "done" ? "bg-green" : status === "doing" ? "bg-teal" : "bg-ghost"
                }`}
              />
              <span className="text-[12px] font-semibold">{TASK_STATUS_LABEL[status]}</span>
              <span className="font-mono text-[10px] text-faint">{column.length}</span>
            </div>
            <div className="flex flex-col gap-2 p-2.5">
              {column.map((t) => (
                <div
                  key={t.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpen(t.id)}
                  onKeyDown={(e) => e.key === "Enter" && onOpen(t.id)}
                  className="cursor-pointer rounded-lg border border-line bg-card px-3 py-2.5 hover:border-teal"
                >
                  <div className="flex items-start gap-2">
                    <span className="mt-px">
                      <DoneToggle task={t} onUpdate={(patch) => onUpdate(t.id, patch)} />
                    </span>
                    <div
                      className={`min-w-0 flex-1 text-[12.5px] leading-[1.4] ${
                        t.status === "done" ? "text-faint line-through" : ""
                      }`}
                    >
                      {t.title}
                    </div>
                    <AssigneePicker
                      value={t.assignee}
                      users={users}
                      me={me}
                      compact
                      align="right"
                      onChange={(assignee) => onUpdate(t.id, { assignee })}
                    />
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-6">
                    <TaskMeta task={t} showStatus={false} />
                  </div>
                </div>
              ))}
              {column.length === 0 && (
                <div className="px-2 py-4 text-center text-[11.5px] text-faint">Nothing here</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── detail drawer ────────────────────────────────────────────────────────

function TaskDrawer({
  task,
  users,
  me,
  projects,
  onClose,
  onUpdate,
  onDelete,
}: {
  task: Task;
  users: AppUser[];
  me: string | null;
  projects: ProjectOption[];
  onClose: () => void;
  onUpdate: (patch: Partial<Task>) => void;
  onDelete: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest("input, textarea, select");
      if (e.key === "Escape" && !typing && !confirmDelete) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, confirmDelete]);

  const saveTitle = () => {
    const t = title.trim();
    if (!t) setTitle(task.title);
    else if (t !== task.title) onUpdate({ title: t });
  };
  const saveNotes = () => {
    if (notes.trim() !== (task.notes ?? "").trim()) onUpdate({ notes: notes.trim() || null });
  };

  const creator = task.createdBy && task.createdBy !== "system" ? task.createdBy : null;

  return (
    <>
      <div className="fixed inset-0 z-[70] bg-black/20" onMouseDown={onClose} role="presentation" />
      <aside
        role="dialog"
        aria-label="Task details"
        className="fixed bottom-0 right-0 top-0 z-[71] flex w-[420px] max-w-full flex-col border-l border-line bg-card shadow-[0_18px_60px_rgba(10,20,25,0.22)]"
      >
        <div className="flex flex-none items-center gap-2 border-b border-hairline px-5 py-3">
          <DoneToggle task={task} onUpdate={onUpdate} />
          <span className="font-mono text-[10px] tracking-[0.06em] text-muted">
            {task.status === "done" ? "DONE" : "TASK"}
          </span>
          <button
            onClick={() => setConfirmDelete(true)}
            title="Delete task"
            className="ml-auto grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-diff-del hover:text-diff-del-line"
          >
            <Icon name="trash" size={13} />
          </button>
          <button
            onClick={onClose}
            title="Close"
            className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-chip hover:text-ink"
          >
            <Icon name="x" size={13} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin px-5 py-4">
          <textarea
            value={title}
            rows={Math.max(1, Math.ceil(title.length / 42))}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              }
              if (e.key === "Escape") {
                setTitle(task.title);
                e.currentTarget.blur();
              }
            }}
            className={`w-full resize-none bg-transparent text-[16px] font-semibold leading-[1.35] outline-none ${
              task.status === "done" ? "text-faint line-through" : ""
            }`}
          />

          <dl className="mt-4 grid grid-cols-[92px_1fr] items-center gap-x-3 gap-y-3 text-[12px]">
            <dt className="text-muted">Status</dt>
            <dd className="flex flex-wrap gap-1">
              {TASK_STATUSES.map((s) => (
                <button
                  key={s}
                  onClick={() => s !== task.status && onUpdate({ status: s })}
                  className={`rounded-full border px-2.5 py-0.5 text-[11px] ${
                    task.status === s
                      ? "border-transparent bg-teal-soft font-semibold text-teal-dark"
                      : "border-edge text-muted hover:border-teal hover:text-teal"
                  }`}
                >
                  {TASK_STATUS_LABEL[s]}
                </button>
              ))}
            </dd>

            <dt className="text-muted">Assignee</dt>
            <dd>
              <AssigneePicker
                value={task.assignee}
                users={users}
                me={me}
                onChange={(assignee) => onUpdate({ assignee })}
              />
            </dd>

            <dt className="text-muted">Priority</dt>
            <dd className="flex gap-1">
              {TASK_PRIORITIES.map((p) => (
                <button
                  key={p}
                  onClick={() => p !== task.priority && onUpdate({ priority: p })}
                  className={`rounded px-1.5 py-0.5 font-mono text-[9.5px] uppercase ${
                    task.priority === p
                      ? `${PRIORITY_STYLE[p]} font-semibold ring-1 ring-current`
                      : "text-faint hover:text-slate"
                  }`}
                >
                  {p}
                </button>
              ))}
            </dd>

            <dt className="text-muted">Due</dt>
            <dd className="flex items-center gap-2">
              <input
                type="date"
                value={toDateInput(task.dueDate)}
                onChange={(e) => onUpdate({ dueDate: e.target.value || null })}
                className={`rounded-md border border-line bg-card px-1.5 py-0.5 text-[11.5px] outline-none focus:border-teal ${
                  isOverdue(task.dueDate, task.status === "done") ? "text-diff-del-line" : "text-slate"
                }`}
              />
              {task.dueDate && (
                <button
                  onClick={() => onUpdate({ dueDate: null })}
                  className="text-[11px] text-muted hover:text-teal"
                >
                  Clear
                </button>
              )}
            </dd>

            <dt className="text-muted">Project</dt>
            <dd className="flex min-w-0 items-center gap-2">
              <select
                value={task.projectId ?? ""}
                onChange={(e) => onUpdate({ projectId: e.target.value || null })}
                className="min-w-0 max-w-[200px] rounded-md border border-line bg-card px-1.5 py-1 text-[11.5px] text-slate outline-none focus:border-teal"
              >
                <option value="">No project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              {task.project && (
                <Link
                  href={`/projects/${task.project.id}`}
                  className="flex-none text-[11px] text-teal hover:underline"
                >
                  Open board →
                </Link>
              )}
            </dd>
          </dl>

          <div className="mt-5 font-mono text-[10px] tracking-[0.08em] text-muted">NOTES</div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={saveNotes}
            placeholder="Details, links, acceptance criteria…"
            rows={Math.max(5, notes.split("\n").length + 1)}
            className="mt-1.5 w-full resize-none rounded-lg border border-line bg-card px-3 py-2 text-[12px] leading-[1.5] outline-none placeholder:text-faint focus:border-teal"
          />

          <div className="mt-5 space-y-1 font-mono text-[10px] text-faint">
            <div>
              CREATED {new Date(task.createdAt).toLocaleString().toUpperCase()}
              {creator && (
                <>
                  {" "}
                  BY {displayName(users.find((u) => u.email === creator), creator).toUpperCase()}
                </>
              )}
            </div>
            {task.completedAt && (
              <div>FINISHED {new Date(task.completedAt).toLocaleString().toUpperCase()}</div>
            )}
          </div>
        </div>
      </aside>

      <DeleteConfirmDialog
        open={confirmDelete}
        title="Delete this task?"
        description={`"${task.title}" will be removed.`}
        warning="This can't be undone."
        confirmLabel="Delete task"
        loading={false}
        error={null}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={onDelete}
      />
    </>
  );
}
