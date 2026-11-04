"use client";

import { useCallback, useEffect, useState } from "react";
import { ListRowsSkeleton } from "@/components/Skeleton";
import { TopStrip } from "@/components/Shell";

type AuditEvent = {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  summary: string;
  detail: string | null;
  actor: string;
  createdAt: string;
};

type Facet = { name: string; count: number };

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

const ACTION_STYLE: Record<string, string> = {
  source: "bg-teal-soft text-teal-dark",
  import: "bg-chip text-slate",
  sync: "bg-chip text-slate",
  document: "bg-green-soft text-green-deep",
  proposal: "bg-amber-soft text-amber",
  setting: "bg-gh-chip text-gh-ink",
  project: "bg-wp-chip text-wp-ink",
  release: "bg-amber-soft text-amber",
  agent: "bg-teal-soft text-teal-dark",
  data: "bg-diff-del text-diff-del-line",
};

const PER_PAGE = 50;

export default function AuditPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState("");
  const [actor, setActor] = useState("");
  const [categories, setCategories] = useState<Facet[]>([]);
  const [actors, setActors] = useState<Facet[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), perPage: String(PER_PAGE) });
    if (category) params.set("category", category);
    if (actor) params.set("actor", actor);
    const data = await fetch(`/api/audit?${params}`).then((r) => r.json());
    setEvents(data.events ?? []);
    setTotal(data.total ?? 0);
    setCategories(data.categories ?? []);
    setActors(data.actors ?? []);
    setLoaded(true);
  }, [page, category, actor]);

  useEffect(() => {
    load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <>
      <TopStrip crumb="Nonaki / Audit Log" right={<span>{total} EVENTS RECORDED</span>} />
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin p-7">
        <div className="flex items-baseline gap-2.5">
          <h1 className="text-[21px] font-semibold tracking-[-0.01em]">Audit log</h1>
          <span className="text-xs text-muted">
            every important action — who did what, and when
          </span>
        </div>

        {/* filters */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 font-mono text-[9.5px] tracking-[0.08em] text-muted">
            ACTION
          </span>
          <button
            onClick={() => {
              setCategory("");
              setPage(1);
            }}
            className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
              category === ""
                ? "border-teal bg-teal-soft font-semibold text-teal-dark"
                : "border-edge bg-card text-muted hover:border-teal hover:text-teal"
            }`}
          >
            All ({categories.reduce((s, c) => s + c.count, 0)})
          </button>
          {categories.map((c) => (
            <button
              key={c.name}
              onClick={() => {
                setCategory(category === c.name ? "" : c.name);
                setPage(1);
              }}
              className={`rounded-full border px-2.5 py-1 text-[11px] uppercase transition-colors ${
                category === c.name
                  ? "border-teal bg-teal-soft font-semibold text-teal-dark"
                  : "border-edge bg-card text-muted hover:border-teal hover:text-teal"
              }`}
            >
              {c.name} ({c.count})
            </button>
          ))}
          {actors.length > 1 && (
            <select
              value={actor}
              onChange={(e) => {
                setActor(e.target.value);
                setPage(1);
              }}
              className="ml-auto rounded-[7px] border border-line bg-card px-2.5 py-1.5 text-[11px] text-slate outline-none focus:border-teal"
            >
              <option value="">All actors</option>
              {actors.map((a) => (
                <option key={a.name} value={a.name}>
                  {a.name} ({a.count})
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="mt-4 overflow-hidden rounded-xl border border-line bg-card">
          {!loaded && <ListRowsSkeleton rows={8} icon={false} />}

          {events.map((e, i) => {
            const cat = e.action.split(".")[0];
            const isExpanded = expanded === e.id;
            return (
              <div
                key={e.id}
                className={`px-[18px] py-2.5 ${
                  i < events.length - 1 ? "border-b border-hairline-2" : ""
                } ${e.detail ? "cursor-pointer hover:bg-hover" : ""}`}
                onClick={() => e.detail && setExpanded(isExpanded ? null : e.id)}
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`w-[130px] flex-none rounded px-1.5 py-0.5 text-center font-mono text-[9px] uppercase ${
                      ACTION_STYLE[cat] ?? "bg-chip text-muted"
                    }`}
                  >
                    {e.action}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px]">{e.summary}</span>
                  <span className="flex-none font-mono text-[9.5px] text-faint">
                    {e.actor.toUpperCase()}
                  </span>
                  <span
                    className="w-[80px] flex-none text-right font-mono text-[9.5px] text-faint"
                    title={new Date(e.createdAt).toLocaleString()}
                  >
                    {timeAgo(e.createdAt).toUpperCase()}
                  </span>
                </div>
                {isExpanded && e.detail && (
                  <pre className="mt-2 overflow-x-auto rounded-lg bg-panel px-3 py-2 font-mono text-[10.5px] leading-relaxed text-slate">
                    {JSON.stringify(JSON.parse(e.detail), null, 2)}
                  </pre>
                )}
              </div>
            );
          })}

          {loaded && events.length === 0 && (
            <div className="px-[18px] py-8 text-center text-xs text-muted">
              No audit events yet — actions like connecting a source, approving a
              proposal or deleting a document will show up here.
            </div>
          )}
        </div>

        {totalPages > 1 && (
          <div className="mt-3 flex items-center justify-end gap-1.5">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded-md border border-edge px-2.5 py-1 text-[11.5px] text-slate hover:border-teal hover:text-teal disabled:opacity-40"
            >
              ← Prev
            </button>
            <span className="px-2 font-mono text-[10px] text-muted">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="rounded-md border border-edge px-2.5 py-1 text-[11.5px] text-slate hover:border-teal hover:text-teal disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        )}
      </div>
    </>
  );
}
