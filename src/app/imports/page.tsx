"use client";

import { useCallback, useEffect, useState } from "react";
import { TopStrip, useStats } from "@/components/Shell";
import { pingImportBar } from "@/components/ImportBar";
import { SourceSelect } from "@/components/SourceSelect";
import { ListRowsSkeleton } from "@/components/Skeleton";

type Job = {
  id: string;
  kind: string;
  status: string;
  total: number;
  cursor: number;
  imported: number;
  proposed: number;
  skipped: number;
  failed: number;
  error: string | null;
  trigger: string;
  retryOfId: string | null;
  createdAt: string;
  finishedAt: string | null;
  durationMs: number;
  source: { id: string; name: string; type: string };
};

type Facet = { status: string; count: number };
type SourceInfo = { id: string; name: string; type: string; siteUrl?: string };

const PER_PAGE = 30;

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

function duration(ms: number): string {
  if (ms < 1000) return "<1s";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

const STATUS_BADGE: Record<string, string> = {
  running: "bg-teal-soft text-teal",
  paused: "bg-amber-soft text-amber",
  completed: "bg-green-soft text-green",
  cancelled: "bg-chip text-muted",
  error: "bg-diff-del text-diff-del-line",
};

export default function ImportsPage() {
  const { refresh } = useStats();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [statuses, setStatuses] = useState<Facet[]>([]);
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), perPage: String(PER_PAGE) });
    if (status) params.set("status", status);
    if (sourceId) params.set("sourceId", sourceId);
    const data = await fetch(`/api/import/history?${params}`).then((r) => r.json());
    setJobs(data.jobs ?? []);
    setTotal(data.total ?? 0);
    setStatuses(data.statuses ?? []);
    setSources(data.sources ?? []);
    setLoaded(true);
  }, [page, status, sourceId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 6000);
    return () => clearInterval(t);
  }, [load]);

  async function retry(job: Job) {
    setRetrying(job.id);
    setNotice(null);
    try {
      const res = await fetch(`/api/import/${job.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retry" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Retry failed");
      pingImportBar();
      setNotice({
        kind: "ok",
        text: `Retry started for ${job.source.name} (${data.job.total} documents) — progress in the bar below.`,
      });
      await load();
      refresh();
    } catch (err) {
      setNotice({
        kind: "err",
        text: err instanceof Error ? err.message : "Retry failed",
      });
    } finally {
      setRetrying(null);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <>
      <TopStrip crumb="Nonaki / Imports" right={<span>{total} JOBS RECORDED</span>} />
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin p-7">
        <div className="flex items-baseline gap-2.5">
          <h1 className="text-[21px] font-semibold tracking-[-0.01em]">Import history</h1>
          <span className="text-xs text-muted">
            every import & sync — what ran, what it did, what broke
          </span>
        </div>

        {/* filters */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 font-mono text-[9.5px] tracking-[0.08em] text-muted">
            STATUS
          </span>
          <button
            onClick={() => {
              setStatus("");
              setPage(1);
            }}
            className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
              status === ""
                ? "border-teal bg-teal-soft font-semibold text-teal-dark"
                : "border-edge bg-card text-muted hover:border-teal hover:text-teal"
            }`}
          >
            All ({statuses.reduce((s, f) => s + f.count, 0)})
          </button>
          {statuses.map((f) => (
            <button
              key={f.status}
              onClick={() => {
                setStatus(status === f.status ? "" : f.status);
                setPage(1);
              }}
              className={`rounded-full border px-2.5 py-1 text-[11px] uppercase transition-colors ${
                status === f.status
                  ? "border-teal bg-teal-soft font-semibold text-teal-dark"
                  : "border-edge bg-card text-muted hover:border-teal hover:text-teal"
              }`}
            >
              {f.status} ({f.count})
            </button>
          ))}
          {sources.length > 0 && (
            <span className="ml-auto">
              <SourceSelect
                sources={sources}
                value={sourceId}
                onChange={(id) => {
                  setSourceId(id);
                  setPage(1);
                }}
              />
            </span>
          )}
        </div>

        {notice && (
          <div
            className={`mt-3 rounded-lg border px-3.5 py-2.5 text-xs leading-relaxed ${
              notice.kind === "ok"
                ? "border-green-soft bg-green-soft text-green-deep"
                : "border-warn-line bg-warn-bg text-warn-text"
            }`}
          >
            {notice.text}
          </div>
        )}

        <div className="mt-4 overflow-hidden rounded-xl border border-line bg-card">
          {/* header */}
          <div className="flex items-center gap-3.5 border-b border-hairline bg-panel px-[18px] py-2 font-mono text-[9.5px] tracking-[0.08em] text-muted">
            <span className="w-[86px] flex-none">STATUS</span>
            <span className="min-w-0 flex-1">SOURCE · RESULT</span>
            <span className="w-[70px] flex-none text-right">DURATION</span>
            <span className="w-[86px] flex-none text-right">WHEN</span>
            <span className="w-[64px] flex-none" />
          </div>

          {!loaded && <ListRowsSkeleton rows={7} icon={false} />}

          {jobs.map((job, i) => {
            const finished = ["completed", "cancelled", "error"].includes(job.status);
            const counts = [
              job.imported && `${job.imported} new`,
              job.proposed && `${job.proposed} proposals`,
              job.skipped && `${job.skipped} unchanged`,
              job.failed && `${job.failed} failed`,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <div
                key={job.id}
                className={`flex items-center gap-3.5 px-[18px] py-3 ${
                  i < jobs.length - 1 ? "border-b border-hairline-2" : ""
                }`}
              >
                <span
                  className={`w-[86px] flex-none rounded px-1.5 py-0.5 text-center font-mono text-[9px] uppercase ${
                    STATUS_BADGE[job.status] ?? "bg-chip text-muted"
                  }`}
                >
                  {job.status}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[12.5px]">
                    <span className="font-semibold">{job.source.name}</span>
                    <span className="rounded bg-chip px-1.5 py-px font-mono text-[8.5px] uppercase text-muted">
                      {job.kind}
                    </span>
                    {job.trigger !== "manual" && (
                      <span className="rounded bg-teal-soft px-1.5 py-px font-mono text-[8.5px] uppercase text-teal-dark">
                        {job.trigger === "schedule" ? "⏱ scheduled" : "↻ retry"}
                      </span>
                    )}
                  </div>
                  <div className="mt-px truncate text-[11px] text-muted">
                    {finished
                      ? counts || "nothing to do"
                      : `${job.cursor} / ${job.total} processed`}
                    {job.error && (
                      <span className="text-orange"> — {job.error}</span>
                    )}
                  </div>
                </div>
                <span className="w-[70px] flex-none text-right font-mono text-[10px] text-faint">
                  {duration(job.durationMs)}
                </span>
                <span
                  className="w-[86px] flex-none text-right font-mono text-[10px] text-faint"
                  title={new Date(job.createdAt).toLocaleString()}
                >
                  {timeAgo(job.createdAt).toUpperCase()}
                </span>
                <span className="flex w-[64px] flex-none justify-end">
                  {finished && job.total > 0 && (
                    <button
                      onClick={() => retry(job)}
                      disabled={retrying !== null}
                      title="Run this job's documents again"
                      className="rounded-md border border-teal-line bg-card px-2.5 py-1 text-[10.5px] font-semibold text-teal hover:bg-teal-soft disabled:opacity-50"
                    >
                      {retrying === job.id ? "…" : "↻ Retry"}
                    </button>
                  )}
                </span>
              </div>
            );
          })}

          {loaded && jobs.length === 0 && (
            <div className="px-[18px] py-8 text-center text-xs text-muted">
              No imports yet — connect a source or hit “Sync now” and every run will
              be recorded here.
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
