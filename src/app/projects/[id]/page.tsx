"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { TopStrip } from "@/components/Shell";
import { Icon } from "@/components/Icons";
import { TextSkeleton } from "@/components/Skeleton";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import {
  PRIORITY_STYLE,
  PROJECT_STATUSES,
  PROJECT_STATUS_LABEL,
  PROJECT_STATUS_STYLE,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_STATUS_LABEL,
  formatDue,
  isOverdue,
  type ProjectStatus,
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
  position: number;
};

type LinkedDoc = {
  id: string;
  title: string;
  kind: string;
  status: string;
  source: { name: string; type: string };
};

type Project = {
  id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  dueDate: string | null;
  tasks: Task[];
  documents: LinkedDoc[];
};

/** ISO → value for <input type="date"> */
const toDateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [openTask, setOpenTask] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`/api/projects/${id}`).then(async (r) => {
      if (r.status === 404) return setNotFound(true);
      const d = await r.json().catch(() => null);
      if (d?.project) setProject(d.project);
    });
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

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

  async function updateProject(patch: Partial<Project>) {
    if (!project) return;
    setProject({ ...project, ...patch });
    await send(`/api/projects/${id}`, "PATCH", patch);
  }

  async function addTask(status: TaskStatus, title: string) {
    const d = await send(`/api/projects/${id}/tasks`, "POST", { title, status });
    if (d?.task && project) setProject({ ...project, tasks: [...project.tasks, d.task] });
  }

  async function updateTask(taskId: string, patch: Partial<Task>) {
    if (!project) return;
    setProject({
      ...project,
      tasks: project.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)),
    });
    const d = await send(`/api/projects/${id}/tasks/${taskId}`, "PATCH", patch);
    // server assigns the new position when a task changes column
    if (d?.task) {
      setProject((p) =>
        p ? { ...p, tasks: p.tasks.map((t) => (t.id === taskId ? d.task : t)) } : p
      );
    }
  }

  async function deleteTask(taskId: string) {
    if (!project) return;
    setProject({ ...project, tasks: project.tasks.filter((t) => t.id !== taskId) });
    setOpenTask(null);
    await send(`/api/projects/${id}/tasks/${taskId}`, "DELETE");
  }

  async function linkDoc(doc: LinkedDoc) {
    if (!project || project.documents.some((d) => d.id === doc.id)) return;
    setProject({ ...project, documents: [...project.documents, doc] });
    await send(`/api/projects/${id}/documents`, "POST", { documentId: doc.id });
  }

  async function unlinkDoc(docId: string) {
    if (!project) return;
    setProject({ ...project, documents: project.documents.filter((d) => d.id !== docId) });
    await send(`/api/projects/${id}/documents`, "DELETE", { documentId: docId });
  }

  async function removeProject() {
    setDeleting(true);
    const ok = await send(`/api/projects/${id}`, "DELETE");
    setDeleting(false);
    if (ok) router.push("/projects");
  }

  if (notFound) {
    return (
      <>
        <TopStrip crumb="Nonaki / Projects / Not found" />
        <div className="p-7 text-[13px] text-muted">
          This project doesn&apos;t exist anymore.{" "}
          <Link href="/projects" className="text-teal hover:underline">
            Back to projects
          </Link>
        </div>
      </>
    );
  }

  const tasks = project?.tasks ?? [];
  const done = tasks.filter((t) => t.status === "done").length;
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;

  return (
    <>
      <TopStrip
        crumb={`Nonaki / Projects / ${project?.name ?? "…"}`}
        right={<span>{done}/{tasks.length} TASKS DONE</span>}
      />
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin p-7">
        <Link
          href="/projects"
          className="font-mono text-[10px] tracking-[0.06em] text-muted hover:text-teal"
        >
          ← ALL PROJECTS
        </Link>

        {!project ? (
          <div className="mt-3 max-w-[640px]">
            <TextSkeleton />
          </div>
        ) : (
          <>
            {/* header */}
            <div className="mt-2 flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <EditableText
                  value={project.name}
                  onSave={(name) => name && updateProject({ name })}
                  className="w-full bg-transparent text-[21px] font-semibold tracking-[-0.01em] outline-none"
                />
                <EditableText
                  value={project.description ?? ""}
                  placeholder="Add a description…"
                  multiline
                  onSave={(description) => updateProject({ description })}
                  className="mt-0.5 w-full resize-none bg-transparent text-[12.5px] leading-[1.5] text-muted outline-none placeholder:text-faint"
                />
              </div>
              <button
                onClick={() => setConfirmDelete(true)}
                title="Delete project"
                className="grid h-8 w-8 flex-none place-items-center rounded-md border border-edge text-muted hover:border-diff-del-line hover:text-diff-del-line"
              >
                <Icon name="trash" size={14} />
              </button>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {PROJECT_STATUSES.map((s) => (
                <button
                  key={s}
                  onClick={() => s !== project.status && updateProject({ status: s })}
                  className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                    project.status === s
                      ? `border-transparent font-semibold ${PROJECT_STATUS_STYLE[s]}`
                      : "border-edge bg-card text-muted hover:border-teal hover:text-teal"
                  }`}
                >
                  {PROJECT_STATUS_LABEL[s]}
                </button>
              ))}
              <label className="ml-2 flex items-center gap-2 text-[11.5px] text-muted">
                Due
                <input
                  type="date"
                  value={toDateInput(project.dueDate)}
                  onChange={(e) => updateProject({ dueDate: e.target.value || null })}
                  className={`rounded-[7px] border border-line bg-card px-2 py-1 text-[11.5px] outline-none focus:border-teal ${
                    isOverdue(project.dueDate, project.status === "done")
                      ? "text-diff-del-line"
                      : "text-slate"
                  }`}
                />
              </label>
              <div className="ml-auto flex items-center gap-2">
                <div className="h-1.5 w-32 overflow-hidden rounded-full bg-track">
                  <div
                    className={`h-full rounded-full ${pct === 100 ? "bg-green" : "bg-teal"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="font-mono text-[10px] text-muted">{pct}%</span>
              </div>
            </div>

            {error && (
              <div className="mt-3 rounded-lg border border-warn-line bg-warn-bg px-3 py-2 text-[11.5px] text-warn-text">
                {error}
              </div>
            )}

            {/* board */}
            <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-3">
              {TASK_STATUSES.map((status) => (
                <Column
                  key={status}
                  status={status}
                  tasks={tasks
                    .filter((t) => t.status === status)
                    .sort((a, b) => a.position - b.position)}
                  openTask={openTask}
                  onToggleOpen={(tid) => setOpenTask(openTask === tid ? null : tid)}
                  onAdd={(title) => addTask(status, title)}
                  onUpdate={updateTask}
                  onDelete={deleteTask}
                />
              ))}
            </div>

            {/* linked docs */}
            <LinkedDocuments
              documents={project.documents}
              onLink={linkDoc}
              onUnlink={unlinkDoc}
            />
          </>
        )}
      </div>

      <DeleteConfirmDialog
        open={confirmDelete}
        title="Delete this project?"
        description={`"${project?.name ?? ""}" and its ${tasks.length} task${
          tasks.length === 1 ? "" : "s"
        } will be removed.`}
        warning="Permanently deletes the project and its tasks. Linked documents stay in the knowledge base."
        confirmLabel="Delete project"
        loading={deleting}
        error={error}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={removeProject}
      />
    </>
  );
}

function Column({
  status,
  tasks,
  openTask,
  onToggleOpen,
  onAdd,
  onUpdate,
  onDelete,
}: {
  status: TaskStatus;
  tasks: Task[];
  openTask: string | null;
  onToggleOpen: (id: string) => void;
  onAdd: (title: string) => void;
  onUpdate: (id: string, patch: Partial<Task>) => void;
  onDelete: (id: string) => void;
}) {
  const [draft, setDraft] = useState("");

  return (
    <div className="flex min-h-[160px] flex-col rounded-xl border border-line bg-panel">
      <div className="flex items-center gap-2 border-b border-hairline px-3.5 py-2.5">
        <span
          className={`h-2 w-2 rounded-full ${
            status === "done" ? "bg-green" : status === "doing" ? "bg-teal" : "bg-ghost"
          }`}
        />
        <span className="text-[12px] font-semibold">{TASK_STATUS_LABEL[status]}</span>
        <span className="font-mono text-[10px] text-faint">{tasks.length}</span>
      </div>

      <div className="flex flex-col gap-2 p-2.5">
        {tasks.map((t) => (
          <TaskCard
            key={t.id}
            task={t}
            open={openTask === t.id}
            onToggle={() => onToggleOpen(t.id)}
            onUpdate={(patch) => onUpdate(t.id, patch)}
            onDelete={() => onDelete(t.id)}
          />
        ))}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.trim()) return;
            onAdd(draft.trim());
            setDraft("");
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="+ Add a task"
            className="w-full rounded-lg border border-dashed border-edge bg-transparent px-3 py-2 text-[12px] outline-none placeholder:text-faint focus:border-teal focus:bg-card"
          />
        </form>
      </div>
    </div>
  );
}

function TaskCard({
  task,
  open,
  onToggle,
  onUpdate,
  onDelete,
}: {
  task: Task;
  open: boolean;
  onToggle: () => void;
  onUpdate: (patch: Partial<Task>) => void;
  onDelete: () => void;
}) {
  const isDone = task.status === "done";
  const late = isOverdue(task.dueDate, isDone);
  const idx = TASK_STATUSES.indexOf(task.status);

  return (
    <div className={`rounded-lg border bg-card ${open ? "border-teal" : "border-line"}`}>
      <div className="flex items-start gap-2 px-3 py-2.5">
        <button
          onClick={() => onUpdate({ status: isDone ? "todo" : "done" })}
          title={isDone ? "Mark as not done" : "Mark as done"}
          className={`mt-px grid h-4 w-4 flex-none place-items-center rounded border ${
            isDone ? "border-green bg-green text-white" : "border-ghost hover:border-teal"
          }`}
        >
          {isDone && <Icon name="check" size={10} />}
        </button>
        <button onClick={onToggle} className="min-w-0 flex-1 text-left">
          <div
            className={`text-[12.5px] leading-[1.4] ${isDone ? "text-faint line-through" : ""}`}
          >
            {task.title}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span
              className={`rounded px-1.5 py-px font-mono text-[9px] uppercase ${
                PRIORITY_STYLE[task.priority]
              }`}
            >
              {task.priority}
            </span>
            {task.dueDate && (
              <span
                className={`font-mono text-[9.5px] ${late ? "text-diff-del-line" : "text-faint"}`}
              >
                {late ? "OVERDUE · " : ""}
                {formatDue(task.dueDate).toUpperCase()}
              </span>
            )}
            {task.notes && !open && (
              <span className="font-mono text-[9.5px] text-faint" title="Has notes">
                ¶
              </span>
            )}
          </div>
        </button>
      </div>

      {open && (
        <div className="border-t border-hairline-2 px-3 py-2.5">
          <EditableText
            value={task.title}
            onSave={(title) => title && onUpdate({ title })}
            className="w-full rounded-md border border-line bg-card px-2 py-1 text-[12px] outline-none focus:border-teal"
          />
          <EditableText
            value={task.notes ?? ""}
            placeholder="Notes…"
            multiline
            onSave={(notes) => onUpdate({ notes })}
            className="mt-1.5 w-full resize-none rounded-md border border-line bg-card px-2 py-1 text-[11.5px] leading-[1.45] outline-none focus:border-teal"
          />
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {TASK_PRIORITIES.map((p) => (
              <button
                key={p}
                onClick={() => onUpdate({ priority: p })}
                className={`rounded px-1.5 py-0.5 font-mono text-[9.5px] uppercase ${
                  task.priority === p
                    ? `${PRIORITY_STYLE[p]} font-semibold ring-1 ring-current`
                    : "text-faint hover:text-slate"
                }`}
              >
                {p}
              </button>
            ))}
            <input
              type="date"
              value={toDateInput(task.dueDate)}
              onChange={(e) => onUpdate({ dueDate: e.target.value || null })}
              className="ml-auto rounded-md border border-line bg-card px-1.5 py-0.5 text-[10.5px] text-slate outline-none focus:border-teal"
            />
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            <button
              onClick={() => onUpdate({ status: TASK_STATUSES[idx - 1] })}
              disabled={idx === 0}
              className="rounded-md border border-edge px-2 py-0.5 text-[11px] text-slate hover:border-teal hover:text-teal disabled:opacity-30"
            >
              ← {idx > 0 ? TASK_STATUS_LABEL[TASK_STATUSES[idx - 1]] : ""}
            </button>
            <button
              onClick={() => onUpdate({ status: TASK_STATUSES[idx + 1] })}
              disabled={idx === TASK_STATUSES.length - 1}
              className="rounded-md border border-edge px-2 py-0.5 text-[11px] text-slate hover:border-teal hover:text-teal disabled:opacity-30"
            >
              {idx < TASK_STATUSES.length - 1 ? TASK_STATUS_LABEL[TASK_STATUSES[idx + 1]] : ""} →
            </button>
            <button
              onClick={onDelete}
              title="Delete task"
              className="ml-auto grid h-6 w-6 place-items-center rounded-md text-muted hover:bg-diff-del hover:text-diff-del-line"
            >
              <Icon name="trash" size={12} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function LinkedDocuments({
  documents,
  onLink,
  onUnlink,
}: {
  documents: LinkedDoc[];
  onLink: (doc: LinkedDoc) => void;
  onUnlink: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  // results are tagged with the query they answer, so "searching" is derived
  const [found, setFound] = useState<{ q: string; docs: LinkedDoc[] }>({ q: "", docs: [] });
  const boxRef = useRef<HTMLDivElement>(null);

  const q = query.trim();
  const results = q && found.q === q ? found.docs : [];
  const searching = Boolean(q) && found.q !== q;

  // debounced title search over the documents API
  useEffect(() => {
    if (!q) return;
    const t = setTimeout(() => {
      fetch(`/api/documents?q=${encodeURIComponent(q)}&perPage=8&status=indexed`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => setFound({ q, docs: d?.documents ?? [] }))
        .catch(() => setFound({ q, docs: [] }));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (!q) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setQuery("");
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [q]);

  const linked = new Set(documents.map((d) => d.id));

  return (
    <div className="mt-6">
      <div className="font-mono text-[10px] tracking-[0.08em] text-muted">
        LINKED DOCUMENTS · {documents.length}
      </div>
      <div className="mt-2 overflow-hidden rounded-xl border border-line bg-card">
        <div ref={boxRef} className="relative border-b border-hairline-2 px-[18px] py-2.5">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the knowledge base to link a document…"
            className="w-full bg-transparent text-[12px] outline-none placeholder:text-faint"
          />
          {query.trim() && (
            <div className="absolute left-3 right-3 top-full z-20 mt-1 overflow-hidden rounded-lg border border-line bg-card shadow-[0_8px_30px_rgba(10,20,25,0.14)]">
              {searching && results.length === 0 && (
                <div className="px-3 py-2 text-[11.5px] text-muted">Searching…</div>
              )}
              {!searching && results.length === 0 && (
                <div className="px-3 py-2 text-[11.5px] text-muted">No matching documents</div>
              )}
              {results.map((d) => (
                <button
                  key={d.id}
                  disabled={linked.has(d.id)}
                  onClick={() => {
                    onLink(d);
                    setQuery("");
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] hover:bg-hover disabled:opacity-50"
                >
                  <Icon name="docs" size={13} className="flex-none text-muted" />
                  <span className="min-w-0 flex-1 truncate">{d.title}</span>
                  <span className="flex-none font-mono text-[9.5px] text-faint">
                    {linked.has(d.id) ? "LINKED" : d.source.name.toUpperCase()}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {documents.length === 0 && (
          <div className="px-[18px] py-5 text-center text-xs text-muted">
            No documents linked yet — link the specs, guides or posts this project relies on.
          </div>
        )}
        {documents.map((d, i) => (
          <div
            key={d.id}
            className={`group flex items-center gap-3 px-[18px] py-2.5 ${
              i < documents.length - 1 ? "border-b border-hairline-2" : ""
            }`}
          >
            <Icon name="docs" size={14} className="flex-none text-muted" />
            <Link
              href={`/docs/${d.id}`}
              className="min-w-0 flex-1 truncate text-[12.5px] hover:text-teal"
            >
              {d.title}
            </Link>
            {d.status === "archived" && (
              <span className="rounded bg-amber-soft px-1.5 py-px font-mono text-[9px] text-amber">
                ARCHIVED
              </span>
            )}
            <span className="flex-none font-mono text-[9.5px] text-faint">
              {d.source.name.toUpperCase()}
            </span>
            <button
              onClick={() => onUnlink(d.id)}
              title="Unlink document"
              className="grid h-6 w-6 flex-none place-items-center rounded-md text-muted opacity-0 hover:bg-chip hover:text-ink group-hover:opacity-100"
            >
              <Icon name="x" size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Text that saves on blur / Enter (single-line). Escape reverts. */
function EditableText({
  value,
  onSave,
  className,
  placeholder,
  multiline,
}: {
  value: string;
  onSave: (v: string) => void;
  className?: string;
  placeholder?: string;
  multiline?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  // resync when the saved value changes underneath us (adjust-state-during-render)
  const [synced, setSynced] = useState(value);
  if (synced !== value) {
    setSynced(value);
    setDraft(value);
  }

  const commit = () => {
    const v = draft.trim();
    if (v === value.trim()) return;
    if (!v && !placeholder) {
      setDraft(value); // required field — don't allow clearing
      return;
    }
    onSave(v);
  };

  const common = {
    value: draft,
    placeholder,
    className,
    onBlur: commit,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setDraft(e.target.value),
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (e.key === "Escape") {
        setDraft(value);
        e.currentTarget.blur();
      }
      if (e.key === "Enter" && !multiline) e.currentTarget.blur();
    },
  };

  return multiline ? (
    <textarea rows={Math.max(1, draft.split("\n").length)} {...common} />
  ) : (
    <input {...common} />
  );
}
