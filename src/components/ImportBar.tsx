"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const IMPORT_STARTED_EVENT = "import-started";
const IMPORT_STARTED_STORAGE_KEY = "nonaki-import-started";
const ACTIVE_POLL_MS = 1_800;
const HIDDEN_POLL_MS = 30_000;
const ERROR_BASE_MS = 5_000;
const ERROR_MAX_MS = 60_000;

export type ImportJobInfo = {
  id: string;
  kind: string;
  status: string;
  total: number;
  cursor: number;
  imported: number;
  proposed: number;
  skipped: number;
  failed: number;
  current: string | null;
  error: string | null;
  source: { name: string; type: string };
};

/** Ask the bar to poll immediately (fired after starting an import). */
export function pingImportBar() {
  window.dispatchEvent(new Event(IMPORT_STARTED_EVENT));
  try {
    localStorage.setItem(IMPORT_STARTED_STORAGE_KEY, String(Date.now()));
  } catch {
    /* cross-tab wakeup is best-effort */
  }
}

/**
 * Floating bar shown at the bottom of every page while an import job is
 * running in the background. Pause / resume / cancel act on the server job.
 */
export function ImportBar({ onJobsChange }: { onJobsChange?: () => void }) {
  const [jobs, setJobs] = useState<ImportJobInfo[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const hadActive = useRef(false);
  const failureCount = useRef(0);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const pendingPoll = useRef(false);
  const jobsRef = useRef<ImportJobInfo[]>([]);
  const pollRef = useRef<() => void>(() => {});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const schedule = useCallback(
    (callback: () => void, ms: number) => {
      clearTimer();
      timer.current = setTimeout(callback, ms);
    },
    [clearTimer]
  );

  const poll = useCallback(async () => {
    if (!mounted.current) return;
    if (inFlight.current) {
      pendingPoll.current = true;
      return;
    }
    inFlight.current = true;

    try {
      const data = await fetch("/api/import/active", { cache: "no-store" }).then((r) => r.json());
      if (!mounted.current) return;
      const next: ImportJobInfo[] = data.jobs ?? [];
      jobsRef.current = next;
      setJobs(next);
      const active = next.some((j) => j.status === "running" || j.status === "paused");
      if (hadActive.current && !active) onJobsChange?.(); // a job just finished
      hadActive.current = active;
      failureCount.current = 0;

      if (active || next.length > 0) {
        const delay = document.visibilityState === "hidden" ? HIDDEN_POLL_MS : ACTIVE_POLL_MS;
        schedule(() => pollRef.current(), delay);
      } else {
        clearTimer();
      }
    } catch {
      if (!mounted.current) return;
      failureCount.current += 1;
      const delay = Math.min(ERROR_BASE_MS * 2 ** (failureCount.current - 1), ERROR_MAX_MS);
      schedule(() => pollRef.current(), delay);
    } finally {
      inFlight.current = false;
      if (mounted.current && pendingPoll.current) {
        pendingPoll.current = false;
        schedule(() => pollRef.current(), 0);
      }
    }
  }, [clearTimer, onJobsChange, schedule]);

  useEffect(() => {
    pollRef.current = () => void poll();
  }, [poll]);

  useEffect(() => {
    mounted.current = true;
    const pollNow = () => pollRef.current();
    const onStorage = (event: StorageEvent) => {
      if (event.key === IMPORT_STARTED_STORAGE_KEY) pollNow();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && jobsRef.current.length > 0) pollNow();
    };

    window.addEventListener(IMPORT_STARTED_EVENT, pollNow);
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisibilityChange);
    schedule(pollNow, 0);

    return () => {
      mounted.current = false;
      clearTimer();
      window.removeEventListener(IMPORT_STARTED_EVENT, pollNow);
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [clearTimer, schedule]);

  async function control(id: string, action: "pause" | "resume" | "cancel") {
    await fetch(`/api/import/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    poll();
  }

  const visible = jobs.filter((j) => !dismissed.has(j.id));
  if (visible.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 left-4 right-4 z-50 flex justify-center">
      <div className="pointer-events-auto flex w-[560px] max-w-full flex-col gap-2">
        {visible.map((job) => {
          const pct = job.total ? Math.min(100, Math.round((job.cursor / job.total) * 100)) : 0;
          const finished = ["completed", "cancelled", "error"].includes(job.status);
          return (
            <div
              key={job.id}
              className="overflow-hidden rounded-xl border border-line bg-card shadow-[0_8px_28px_rgba(10,20,25,0.14)]"
            >
              <div className="flex items-center gap-2.5 px-4 py-2.5">
                <span
                  className={`h-2 w-2 flex-none rounded-full ${
                    job.status === "running"
                      ? "pulse-dot bg-teal"
                      : job.status === "paused"
                        ? "bg-amber"
                        : job.status === "completed"
                          ? "bg-green"
                          : job.status === "error"
                            ? "bg-orange"
                            : "bg-faint"
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2 text-xs">
                    <b className="truncate">
                      {job.status === "completed"
                        ? `${job.source.name} — ${job.kind === "sync" ? "sync" : "import"} complete`
                        : job.status === "cancelled"
                          ? `${job.source.name} — cancelled`
                          : job.status === "error"
                            ? `${job.source.name} — failed`
                            : job.status === "paused"
                              ? `${job.source.name} — paused`
                              : `Importing from ${job.source.name}…`}
                    </b>
                    <span className="ml-auto flex-none font-mono text-[10px] text-muted">
                      {finished
                        ? `${job.imported} new · ${job.proposed} proposals · ${job.skipped} unchanged${job.failed ? ` · ${job.failed} failed` : ""}`
                        : `${job.cursor} / ${job.total}`}
                    </span>
                  </div>
                  {!finished && (
                    <div className="mt-0.5 truncate text-[10.5px] text-faint">
                      {job.current ?? "Preparing…"}
                    </div>
                  )}
                  {job.status === "error" && job.error && (
                    <div className="mt-0.5 truncate text-[10.5px] text-orange">{job.error}</div>
                  )}
                </div>
                <div className="flex flex-none items-center gap-1">
                  {job.status === "running" && (
                    <button
                      onClick={() => control(job.id, "pause")}
                      title="Pause"
                      className="rounded-md border border-line px-2 py-1 text-[10.5px] font-semibold text-slate hover:border-teal hover:text-teal"
                    >
                      ⏸ Pause
                    </button>
                  )}
                  {job.status === "paused" && (
                    <button
                      onClick={() => control(job.id, "resume")}
                      title="Resume"
                      className="rounded-md bg-teal px-2 py-1 text-[10.5px] font-semibold text-white hover:bg-teal-dark"
                    >
                      ▶ Resume
                    </button>
                  )}
                  {(job.status === "running" || job.status === "paused") && (
                    <button
                      onClick={() => control(job.id, "cancel")}
                      title="Cancel"
                      className="rounded-md px-2 py-1 text-[10.5px] font-semibold text-muted hover:text-orange"
                    >
                      ✕ Cancel
                    </button>
                  )}
                  {finished && (
                    <button
                      onClick={() => setDismissed((d) => new Set(d).add(job.id))}
                      className="rounded-md px-2 py-1 text-[10.5px] text-muted hover:text-ink"
                    >
                      Dismiss
                    </button>
                  )}
                </div>
              </div>
              <div className="h-1 bg-track">
                <div
                  className={`h-full transition-all duration-500 ${
                    job.status === "error"
                      ? "bg-orange"
                      : job.status === "cancelled"
                        ? "bg-faint"
                        : job.status === "paused"
                          ? "bg-amber"
                          : "bg-teal"
                  }`}
                  style={{ width: `${finished ? 100 : pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
