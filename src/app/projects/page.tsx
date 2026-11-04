"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { TopStrip } from "@/components/Shell";
import { Icon } from "@/components/Icons";
import { ListRowsSkeleton } from "@/components/Skeleton";
import {
  PROJECT_STATUSES,
  PROJECT_STATUS_LABEL,
  PROJECT_STATUS_STYLE,
  formatDue,
  isOverdue,
  type ProjectStatus,
} from "@/lib/projects";

type ProjectSummary = {
  id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  dueDate: string | null;
  updatedAt: string;
  taskCount: number;
  doneCount: number;
  overdueCount: number;
  documentCount: number;
};

const STATUS_FILTERS: (ProjectStatus | "")[] = ["", ...PROJECT_STATUSES];

export default function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<ProjectStatus | "">("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    fetch("/api/projects")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setProjects(d.projects ?? []);
        setLoaded(true);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const visible = filter ? projects.filter((p) => p.status === filter) : projects;
  const activeCount = projects.filter((p) => p.status !== "done").length;

  return (
    <>
      <TopStrip
        crumb="Nonaki / Projects"
        right={<span>{activeCount} OPEN PROJECT{activeCount === 1 ? "" : "S"}</span>}
      />
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin p-7">
        <div className="flex items-center gap-2.5">
          <div className="flex items-baseline gap-2.5">
            <h1 className="text-[21px] font-semibold tracking-[-0.01em]">Projects</h1>
            <span className="text-xs text-muted">
              plan work as tasks, linked to the documents behind it
            </span>
          </div>
          <button
            onClick={() => setCreating(true)}
            className="ml-auto flex items-center gap-1.5 rounded-md bg-teal px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-teal-dark"
          >
            <Icon name="plus" size={13} /> New project
          </button>
        </div>

        {creating && (
          <NewProjectForm
            onCancel={() => setCreating(false)}
            onCreated={() => {
              setCreating(false);
              load();
            }}
          />
        )}

        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 font-mono text-[9.5px] tracking-[0.08em] text-muted">STATUS</span>
          {STATUS_FILTERS.map((s) => {
            const count = s ? projects.filter((p) => p.status === s).length : projects.length;
            return (
              <button
                key={s || "all"}
                onClick={() => setFilter(s)}
                className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                  filter === s
                    ? "border-teal bg-teal-soft font-semibold text-teal-dark"
                    : "border-edge bg-card text-muted hover:border-teal hover:text-teal"
                }`}
              >
                {s ? PROJECT_STATUS_LABEL[s] : "All"} ({count})
              </button>
            );
          })}
        </div>

        {!loaded && (
          <div className="mt-4 overflow-hidden rounded-xl border border-line bg-card">
            <ListRowsSkeleton rows={4} icon={false} />
          </div>
        )}

        {loaded && visible.length === 0 && (
          <div className="mt-4 rounded-xl border border-dashed border-edge bg-card px-6 py-10 text-center">
            <div className="text-[13px] font-semibold">
              {projects.length === 0 ? "No projects yet" : "No projects with this status"}
            </div>
            <div className="mt-1 text-xs text-muted">
              {projects.length === 0
                ? "Create a project to break work into tasks and link the docs it depends on."
                : "Pick another status filter above."}
            </div>
          </div>
        )}

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((p) => {
            const pct = p.taskCount ? Math.round((p.doneCount / p.taskCount) * 100) : 0;
            const late = isOverdue(p.dueDate, p.status === "done");
            return (
              <Link
                key={p.id}
                href={`/projects/${p.id}`}
                className="group flex flex-col rounded-xl border border-line bg-card p-4 transition-colors hover:border-teal"
              >
                <div className="flex items-start gap-2">
                  <span className="min-w-0 flex-1 truncate text-[14px] font-semibold group-hover:text-teal-dark">
                    {p.name}
                  </span>
                  <span
                    className={`flex-none rounded-[5px] px-1.5 py-0.5 text-[9.5px] font-semibold uppercase ${
                      PROJECT_STATUS_STYLE[p.status]
                    }`}
                  >
                    {PROJECT_STATUS_LABEL[p.status]}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 min-h-[34px] text-[11.5px] leading-[1.45] text-muted">
                  {p.description || "No description"}
                </p>

                <div className="mt-3 flex items-center gap-2 text-[10.5px] text-muted">
                  <span className="font-mono">
                    {p.doneCount}/{p.taskCount} TASKS
                  </span>
                  <span className="ml-auto font-mono">{pct}%</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-track">
                  <div
                    className={`h-full rounded-full ${pct === 100 ? "bg-green" : "bg-teal"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>

                <div className="mt-3 flex items-center gap-3 font-mono text-[9.5px] text-faint">
                  <span className="flex items-center gap-1">
                    <Icon name="docs" size={11} /> {p.documentCount} DOC{p.documentCount === 1 ? "" : "S"}
                  </span>
                  {p.overdueCount > 0 && (
                    <span className="text-diff-del-line">{p.overdueCount} OVERDUE</span>
                  )}
                  {p.dueDate && (
                    <span className={`ml-auto ${late ? "text-diff-del-line" : ""}`}>
                      DUE {formatDue(p.dueDate).toUpperCase()}
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </>
  );
}

function NewProjectForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description, dueDate: dueDate || null }),
    });
    setSaving(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? "Could not create project");
      return;
    }
    onCreated();
  }

  return (
    <form
      onSubmit={submit}
      className="mt-4 rounded-xl border border-teal-line bg-card p-4"
    >
      <div className="font-mono text-[10px] tracking-[0.08em] text-muted">NEW PROJECT</div>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Project name"
        autoFocus
        className="mt-2 w-full rounded-[7px] border border-line bg-card px-3 py-2 text-[13px] outline-none focus:border-teal"
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="What is this project for? (optional)"
        rows={2}
        className="mt-2 w-full resize-none rounded-[7px] border border-line bg-card px-3 py-2 text-[12px] outline-none focus:border-teal"
      />
      <div className="mt-2 flex items-center gap-2">
        <label className="flex items-center gap-2 text-[11.5px] text-muted">
          Due date
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="rounded-[7px] border border-line bg-card px-2 py-1 text-[11.5px] text-slate outline-none focus:border-teal"
          />
        </label>
        {error && <span className="text-[11.5px] text-diff-del-line">{error}</span>}
        <button
          type="button"
          onClick={onCancel}
          className="ml-auto rounded-md border border-edge bg-card px-3 py-1.5 text-[12px] font-semibold text-slate hover:border-teal hover:text-teal"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving || !name.trim()}
          className="rounded-md bg-teal px-3.5 py-1.5 text-[12px] font-semibold text-white hover:bg-teal-dark disabled:opacity-60"
        >
          {saving ? "Creating…" : "Create project"}
        </button>
      </div>
    </form>
  );
}
