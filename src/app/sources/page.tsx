"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TopStrip, useStats } from "@/components/Shell";
import { Icon } from "@/components/Icons";
import { pingImportBar } from "@/components/ImportBar";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { SourceIcon, WordPressMark, GitHubMark } from "@/components/SourceIcon";
import { ListRowsSkeleton, TextSkeleton } from "@/components/Skeleton";

type LastJob = {
  id: string;
  kind: string;
  status: string;
  imported: number;
  proposed: number;
  skipped: number;
  failed: number;
  error: string | null;
  trigger: string;
  createdAt: string;
  finishedAt: string | null;
};

type Source = {
  id: string;
  type: string;
  name: string;
  config: string | null;
  status: string;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  syncInterval: string;
  nextSyncAt: string | null;
  lastJob: LastJob | null;
  pendingProposals: number;
  _count: { documents: number };
};

type SyncLog = { id: string; message: string; level: string; createdAt: string };
type PreviewItem = { externalId: string; title: string; kind: string; state?: string };
type SelMode = "all" | "count" | "select";

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

function timeUntil(iso: string | null): string {
  if (!iso) return "—";
  const s = Math.floor((new Date(iso).getTime() - Date.now()) / 1000);
  if (s <= 0) return "due now";
  if (s < 3600) return `in ${Math.max(1, Math.floor(s / 60))} min`;
  if (s < 86400) return `in ${Math.floor(s / 3600)} h`;
  return `in ${Math.floor(s / 86400)} d`;
}

const SYNC_INTERVALS = [
  ["manual", "Manual only"],
  ["hourly", "Hourly"],
  ["daily", "Daily"],
  ["weekly", "Weekly"],
] as const;

export default function SourcesPage() {
  const { stats, refresh } = useStats();
  const [sources, setSources] = useState<Source[]>([]);
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState<{
    id: string;
    name: string;
    docs: number;
  } | null>(null);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // connect flow state
  const [showConnect, setShowConnect] = useState(false);
  const [srcType, setSrcType] = useState<"wordpress" | "github">("wordpress");
  const [wpUrl, setWpUrl] = useState("");
  const [ghRepo, setGhRepo] = useState("");
  const [ghToken, setGhToken] = useState("");
  const [ghState, setGhState] = useState<"all" | "open" | "closed">("all");
  const [fetching, setFetching] = useState(false);
  const [preview, setPreview] = useState<PreviewItem[] | null>(null);
  const [selMode, setSelMode] = useState<SelMode>("all");
  const [selCount, setSelCount] = useState("10");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [itemFilter, setItemFilter] = useState("");
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, d] = await Promise.all([
        fetch("/api/sources").then((r) => (r.ok ? r.json() : null)),
        fetch("/api/digest?logs=25").then((r) => (r.ok ? r.json() : null)),
      ]);
      if (s) setSources(s.sources ?? []);
      if (d) setLogs(d.recentLogs ?? []);
      if (s || d) setLoaded(true);
      refresh();
    } catch {
      /* transient network error — next poll retries */
    }
  }, [refresh]);

  useEffect(() => {
    load();
    const t = setInterval(load, 6000);
    return () => clearInterval(t);
  }, [load]);

  const config = useMemo(
    () =>
      srcType === "wordpress"
        ? { url: wpUrl }
        : {
            repo: ghRepo,
            state: ghState,
            ...(ghToken.trim() ? { token: ghToken.trim() } : {}),
          },
    [srcType, wpUrl, ghRepo, ghToken, ghState]
  );

  function resetConnect() {
    setPreview(null);
    setSelMode("all");
    setSelected(new Set());
    setItemFilter("");
    setNotice(null);
  }

  async function fetchPreview() {
    setFetching(true);
    setNotice(null);
    try {
      const res = await fetch("/api/sources/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: srcType, config }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not fetch documents");
      setPreview(data.items);
      setSelected(new Set(data.items.map((i: PreviewItem) => i.externalId)));
      setSelMode("all");
    } catch (err) {
      setNotice({ kind: "err", text: err instanceof Error ? err.message : "Preview failed" });
    } finally {
      setFetching(false);
    }
  }

  async function startImport() {
    if (!preview) return;
    setStarting(true);
    setNotice(null);
    const selection =
      selMode === "all"
        ? { mode: "all" }
        : selMode === "count"
          ? { mode: "count", count: Math.max(1, Number(selCount) || 1) }
          : { mode: "select", selected: [...selected] };
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: srcType, config, selection }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Import failed to start");
      pingImportBar();
      setShowConnect(false);
      resetConnect();
      setWpUrl("");
      setGhRepo("");
      setGhToken("");
      setNotice({
        kind: "ok",
        text: `Import started in the background (${data.job.total} documents) — you can keep browsing, progress is in the bar below.`,
      });
      await load();
    } catch (err) {
      setNotice({ kind: "err", text: err instanceof Error ? err.message : "Import failed" });
    } finally {
      setStarting(false);
    }
  }

  async function syncSource(id: string) {
    setNotice(null);
    const res = await fetch(`/api/sources/${id}/sync`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      setNotice({ kind: "err", text: data.error ?? "Sync failed to start" });
      return;
    }
    pingImportBar();
    setNotice({
      kind: "ok",
      text: `Sync running in the background (${data.job.total} documents to check).`,
    });
    await load();
  }

  async function setSchedule(id: string, syncInterval: string) {
    setNotice(null);
    const res = await fetch(`/api/sources/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ syncInterval }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setNotice({ kind: "err", text: data.error ?? "Could not update the schedule" });
      return;
    }
    await load();
  }

  async function disconnect() {
    if (!confirmDisconnect) return;
    const { id, name } = confirmDisconnect;
    setConfirmDisconnect(null);
    setNotice(null);
    setDeletingIds((s) => new Set(s).add(id));
    try {
      const res = await fetch(`/api/sources/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Disconnect failed");
      }
      setNotice({
        kind: "ok",
        text: `"${name}" disconnected — its documents were removed from the index.`,
      });
      await load();
    } catch (err) {
      setNotice({
        kind: "err",
        text: `Could not disconnect "${name}": ${err instanceof Error ? err.message : "unknown error"}`,
      });
    } finally {
      setDeletingIds((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    }
  }

  async function uploadFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    setUploading(true);
    setNotice(null);
    const formData = new FormData();
    for (const f of list) formData.append("files", f);
    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();
      const ok = data.uploaded?.length ?? 0;
      const bad = data.errors?.length ?? 0;
      setNotice({
        kind: bad && !ok ? "err" : "ok",
        text: [
          ok && `${ok} file(s) parsed, chunked & indexed`,
          bad &&
            `${bad} failed: ${data.errors.map((e: { file: string; error: string }) => `${e.file} (${e.error})`).join("; ")}`,
        ]
          .filter(Boolean)
          .join(" · "),
      });
      await load();
    } catch {
      setNotice({ kind: "err", text: "Upload failed" });
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  const connected = sources.filter((s) => s.type !== "upload" && s.type !== "manual");
  const uploadSource = sources.find((s) => s.type === "upload");
  const manualSource = sources.find((s) => s.type === "manual");
  const filteredPreview = (preview ?? []).filter(
    (i) => !itemFilter || i.title.toLowerCase().includes(itemFilter.toLowerCase())
  );
  const effectiveCount =
    selMode === "all"
      ? preview?.length ?? 0
      : selMode === "count"
        ? Math.min(Math.max(1, Number(selCount) || 1), preview?.length ?? 0)
        : selected.size;

  return (
    <>
      <TopStrip
        crumb="Nonaki / Sources"
        right={
          <span>
            LAST SYNC{" "}
            {timeAgo(
              sources.map((s) => s.lastSyncAt).filter(Boolean).sort().reverse()[0] ?? null
            ).toUpperCase()}
          </span>
        }
      />
      <div className="flex min-h-0 flex-1 gap-7 overflow-y-auto scrollbar-thin p-7">
        {/* left */}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2.5">
            <h1 className="text-[21px] font-semibold tracking-[-0.01em]">Data sources</h1>
            <span className="text-xs text-muted">
              {sources.length} connected · answers cite across all of them
            </span>
            <button
              onClick={() => {
                setShowConnect((v) => !v);
                resetConnect();
              }}
              className="ml-auto rounded-[7px] bg-teal px-3.5 py-[7px] text-xs font-semibold text-white hover:bg-teal-dark"
            >
              <span className="flex items-center gap-1.5"><Icon name="plus" size={13} /> Connect source</span>
            </button>
          </div>

          {notice && (
            <div
              className={`mt-3 whitespace-pre-line rounded-lg border px-3.5 py-2.5 text-xs leading-relaxed ${
                notice.kind === "ok"
                  ? "border-green-soft bg-green-soft text-green-deep"
                  : "border-warn-line bg-warn-bg text-warn-text"
              }`}
            >
              {notice.text}
            </div>
          )}

          {/* ── connect flow ─────────────────────────────── */}
          {showConnect && (
            <div className="mt-3 rounded-xl border border-teal-line bg-teal-mist p-4">
              {/* type tabs */}
              <div className="flex gap-1.5">
                {(
                  [
                    ["wordpress", "WordPress"],
                    ["github", "GitHub"],
                  ] as const
                ).map(([type, label]) => (
                  <button
                    key={type}
                    onClick={() => {
                      setSrcType(type);
                      resetConnect();
                    }}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                      srcType === type
                        ? "border-teal bg-card text-teal-dark"
                        : "border-transparent text-muted hover:text-ink"
                    }`}
                  >
                    <span
                      className={`grid h-5 w-5 place-items-center rounded ${
                        type === "wordpress"
                          ? "bg-wp-chip text-wp-ink"
                          : "bg-gh-chip text-gh-ink"
                      }`}
                    >
                      {type === "wordpress" ? (
                        <WordPressMark size={13} />
                      ) : (
                        <GitHubMark size={13} />
                      )}
                    </span>
                    {label}
                  </button>
                ))}
              </div>

              {/* fields */}
              {srcType === "wordpress" ? (
                <div className="mt-3">
                  <div className="text-[11.5px] leading-relaxed text-dim">
                    Published posts & pages via the public REST API
                    (<span className="font-mono text-[10.5px]">/wp-json/wp/v2</span>).
                  </div>
                  <div className="mt-2 flex gap-2">
                    <input
                      value={wpUrl}
                      onChange={(e) => setWpUrl(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && fetchPreview()}
                      placeholder="yoursite.com"
                      className="min-w-0 flex-1 rounded-[7px] border border-line bg-card px-3 py-2 text-[13px] outline-none focus:border-teal"
                    />
                    <button
                      onClick={fetchPreview}
                      disabled={fetching || !wpUrl.trim()}
                      className="flex-none rounded-[7px] bg-teal px-4 py-2 text-xs font-semibold text-white hover:bg-teal-dark disabled:opacity-50"
                    >
                      {fetching ? "Fetching…" : "Fetch documents"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-3">
                  <div className="text-[11.5px] leading-relaxed text-dim">
                    Imports <b>issues and pull requests</b> (title, description &
                    comments — open and closed). For <b>private repos</b>, add a
                    personal access token with{" "}
                    <span className="font-mono text-[10.5px]">Issues / Pull requests: read</span>.
                    <b> Organization repos:</b> a fine-grained token must have the{" "}
                    <b>organization as its “Resource owner”</b> (not your personal
                    account) — or use a classic token with the{" "}
                    <span className="font-mono text-[10.5px]">repo</span> scope, which
                    inherits your org access. Tokens are stored locally in SQLite and
                    never sent to the browser.
                  </div>
                  <div className="mt-2">
                    <input
                      value={ghRepo}
                      onChange={(e) => setGhRepo(e.target.value)}
                      placeholder="owner/repo  or  https://github.com/owner/repo"
                      className="w-full min-w-0 rounded-[7px] border border-line bg-card px-3 py-2 text-[13px] outline-none focus:border-teal"
                    />
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="flex-none text-[11px] text-muted">Include:</span>
                    {(
                      [
                        ["all", "Open + closed"],
                        ["open", "Open only"],
                        ["closed", "Closed only"],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        onClick={() => {
                          setGhState(value);
                          setPreview(null); // state change → re-fetch needed
                        }}
                        className={`rounded-md border px-2.5 py-1 text-[11px] ${
                          ghState === value
                            ? "border-teal bg-card font-semibold text-teal-dark"
                            : "border-edge bg-card text-muted hover:border-teal"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <input
                      value={ghToken}
                      onChange={(e) => setGhToken(e.target.value)}
                      type="password"
                      placeholder="github_pat_… (only needed for private repos)"
                      className="min-w-0 flex-1 rounded-[7px] border border-line bg-card px-3 py-2 font-mono text-xs outline-none focus:border-teal"
                    />
                    <button
                      onClick={fetchPreview}
                      disabled={fetching || !ghRepo.trim()}
                      className="flex-none rounded-[7px] bg-teal px-4 py-2 text-xs font-semibold text-white hover:bg-teal-dark disabled:opacity-50"
                    >
                      {fetching ? "Fetching…" : "Fetch documents"}
                    </button>
                  </div>
                </div>
              )}

              {/* selection step */}
              {preview && (
                <div className="mt-4 rounded-lg border border-line bg-card p-3.5">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[13px] font-semibold">
                      {preview.length} documents found
                    </span>
                    <span className="text-[11px] text-muted">— choose what to import</span>
                  </div>

                  <div className="mt-2.5 flex flex-col gap-1.5 text-xs">
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="radio"
                        checked={selMode === "all"}
                        onChange={() => setSelMode("all")}
                        className="accent-[#0e7f93]"
                      />
                      <span>
                        <b>Import all</b> ({preview.length}) — default
                      </span>
                    </label>
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="radio"
                        checked={selMode === "count"}
                        onChange={() => setSelMode("count")}
                        className="accent-[#0e7f93]"
                      />
                      <span>Import the first</span>
                      <input
                        type="number"
                        min={1}
                        max={preview.length}
                        value={selCount}
                        onFocus={() => setSelMode("count")}
                        onChange={(e) => setSelCount(e.target.value)}
                        className="w-16 rounded border border-line px-1.5 py-0.5 text-xs outline-none focus:border-teal"
                      />
                      <span>documents</span>
                    </label>
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="radio"
                        checked={selMode === "select"}
                        onChange={() => setSelMode("select")}
                        className="accent-[#0e7f93]"
                      />
                      <span>
                        <b>Select manually</b> ({selected.size} selected)
                      </span>
                    </label>
                  </div>

                  {selMode === "select" && (
                    <div className="mt-2.5 rounded-lg border border-hairline">
                      <div className="flex items-center gap-2 border-b border-hairline px-2.5 py-1.5">
                        <input
                          value={itemFilter}
                          onChange={(e) => setItemFilter(e.target.value)}
                          placeholder="Filter…"
                          className="min-w-0 flex-1 bg-transparent text-[11.5px] outline-none"
                        />
                        <button
                          onClick={() =>
                            setSelected(new Set(filteredPreview.map((i) => i.externalId)))
                          }
                          className="flex-none text-[10.5px] font-semibold text-teal"
                        >
                          All
                        </button>
                        <button
                          onClick={() => setSelected(new Set())}
                          className="flex-none text-[10.5px] font-semibold text-muted"
                        >
                          None
                        </button>
                      </div>
                      <div className="max-h-52 overflow-y-auto scrollbar-thin">
                        {filteredPreview.map((item) => (
                          <label
                            key={item.externalId}
                            className="flex cursor-pointer items-center gap-2 border-b border-row-line px-2.5 py-1.5 text-[11.5px] last:border-0 hover:bg-hover"
                          >
                            <input
                              type="checkbox"
                              checked={selected.has(item.externalId)}
                              onChange={(e) => {
                                const next = new Set(selected);
                                if (e.target.checked) next.add(item.externalId);
                                else next.delete(item.externalId);
                                setSelected(next);
                              }}
                              className="accent-[#0e7f93]"
                            />
                            <span className="truncate">{item.title}</span>
                            {item.state && (
                              <span
                                className={`ml-auto flex-none rounded px-1.5 py-px font-mono text-[8.5px] uppercase ${
                                  item.state === "open"
                                    ? "bg-green-soft text-green"
                                    : item.state === "merged"
                                      ? "bg-teal-soft text-teal-dark"
                                      : "bg-chip text-muted"
                                }`}
                              >
                                {item.state}
                              </span>
                            )}
                            <span
                              className={`flex-none rounded bg-chip px-1.5 py-px font-mono text-[8.5px] uppercase text-muted ${
                                item.state ? "" : "ml-auto"
                              }`}
                            >
                              {item.kind}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="mt-3 flex items-center gap-2">
                    <button
                      onClick={startImport}
                      disabled={starting || effectiveCount === 0}
                      className="rounded-[7px] bg-teal px-4 py-2 text-xs font-semibold text-white hover:bg-teal-dark disabled:opacity-50"
                    >
                      {starting
                        ? "Starting…"
                        : `Import ${effectiveCount} document${effectiveCount === 1 ? "" : "s"} in background`}
                    </button>
                    <span className="text-[10.5px] text-faint">
                      Runs in the background — pause or cancel from the progress bar.
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── sources list ─────────────────────────────── */}
          <div className="mt-4 overflow-hidden rounded-xl border border-line bg-card">
            {!loaded && <ListRowsSkeleton rows={3} />}

            {connected.map((s) => {
              const cfg = JSON.parse(s.config ?? "{}") as Record<string, string>;
              const isWp = s.type === "wordpress";
              const isDeleting = deletingIds.has(s.id);
              const lastJobResult = s.lastJob
                ? [
                    s.lastJob.imported && `${s.lastJob.imported} new`,
                    s.lastJob.proposed && `${s.lastJob.proposed} proposals`,
                    s.lastJob.skipped && `${s.lastJob.skipped} unchanged`,
                    s.lastJob.failed && `${s.lastJob.failed} failed`,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "nothing to do"
                : null;
              return (
                <div
                  key={s.id}
                  className={`border-b border-hairline-2 px-[18px] py-3.5 transition-opacity ${
                    isDeleting ? "pointer-events-none opacity-55 select-none" : ""
                  }`}
                >
                  <div className="flex items-center gap-3.5">
                    <SourceIcon type={s.type} siteUrl={isWp ? cfg.url : undefined} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-[13px] font-semibold">
                        {s.name}
                        {!isWp && cfg.token && (
                          <span
                            title="Private repo access"
                            className="rounded bg-chip px-1.5 py-px font-mono text-[8.5px] text-muted"
                          >
                            🔒 PRIVATE
                          </span>
                        )}
                      </div>
                      <div className="mt-px truncate text-[11.5px] text-muted">
                        {isWp
                          ? cfg.url
                          : `github.com/${cfg.repo} — issues & PRs${
                              cfg.state && cfg.state !== "all" ? ` (${cfg.state} only)` : ""
                            }`}
                      </div>
                    </div>
                    <span
                      className={`ml-auto flex-none rounded-[5px] px-2 py-[3px] font-mono text-[9.5px] ${
                        isDeleting
                          ? "pulse-dot bg-diff-del text-diff-del-line"
                          : s.status === "error"
                            ? "bg-amber-soft text-amber"
                            : s.status === "syncing"
                              ? "bg-teal-soft text-teal"
                              : "bg-green-soft text-green"
                      }`}
                    >
                      {isDeleting
                        ? "DELETING…"
                        : s.status === "syncing"
                          ? "IMPORTING…"
                          : s.status === "error"
                            ? "SYNC ERROR"
                            : `SYNCED · ${timeAgo(s.lastSyncAt).toUpperCase()}`}
                    </span>
                    <button
                      onClick={() => syncSource(s.id)}
                      disabled={s.status === "syncing" || isDeleting}
                      className="flex-none rounded-md border border-teal-line bg-card px-3 py-1 text-[11.5px] font-semibold text-teal hover:bg-teal-soft disabled:opacity-50"
                    >
                      Sync now
                    </button>
                    <button
                      onClick={() =>
                        setConfirmDisconnect({ id: s.id, name: s.name, docs: s._count.documents })
                      }
                      disabled={isDeleting}
                      title="Disconnect"
                      className="flex-none px-1 text-muted hover:text-ink disabled:opacity-50"
                    >
                      <Icon name="x" size={14} />
                    </button>
                  </div>

                  {isDeleting && (
                    <div className="mt-2.5">
                      <div className="bar-indeterminate h-1 rounded-[3px] bg-track text-diff-del-line" />
                      <div className="mt-1.5 font-mono text-[9.5px] text-muted">
                        REMOVING {s._count.documents} DOC
                        {s._count.documents === 1 ? "" : "S"} FROM THE WEAVIATE INDEX…
                      </div>
                    </div>
                  )}

                  {/* health strip */}
                  {!isDeleting && (
                  <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-lg bg-panel px-3 py-2 font-mono text-[9.5px] text-muted">
                    <span>
                      DOCS <b className="text-ink">{s._count.documents}</b>
                    </span>
                    <span>
                      LAST SYNC{" "}
                      <b className="text-ink">{timeAgo(s.lastSyncAt).toUpperCase()}</b>
                    </span>
                    <span>
                      NEXT{" "}
                      <b className="text-ink">
                        {s.syncInterval === "manual"
                          ? "MANUAL"
                          : timeUntil(s.nextSyncAt).toUpperCase()}
                      </b>
                    </span>
                    <span className={s.pendingProposals > 0 ? "text-amber" : ""}>
                      PROPOSALS <b>{s.pendingProposals}</b>
                    </span>
                    {lastJobResult && s.lastJob && (
                      <span title={`Last ${s.lastJob.kind}: ${lastJobResult}`}>
                        LAST RUN{" "}
                        <b
                          className={
                            s.lastJob.status === "error" ? "text-orange" : "text-ink"
                          }
                        >
                          {s.lastJob.status.toUpperCase()}
                        </b>
                      </span>
                    )}
                    <label className="ml-auto flex items-center gap-1.5">
                      AUTO-SYNC
                      <select
                        value={s.syncInterval}
                        onChange={(e) => setSchedule(s.id, e.target.value)}
                        className="rounded-md border border-edge bg-card px-1.5 py-0.5 font-mono text-[9.5px] text-ink outline-none focus:border-teal"
                      >
                        {SYNC_INTERVALS.map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  )}
                  {!isDeleting && (s.lastSyncError || s.lastJob?.error) && (
                    <div className="mt-1.5 rounded-lg border border-warn-line bg-warn-bg px-3 py-1.5 text-[10.5px] leading-relaxed text-warn-text">
                      <b>Last failure:</b> {s.lastSyncError ?? s.lastJob?.error}
                    </div>
                  )}
                </div>
              );
            })}

            {loaded && connected.length === 0 && (
              <div className="border-b border-hairline-2 px-[18px] py-4 text-xs text-muted">
                No WordPress site or GitHub repo connected yet — click{" "}
                <button
                  onClick={() => {
                    setShowConnect(true);
                    resetConnect();
                  }}
                  className="font-semibold text-teal"
                >
                  <span className="flex items-center gap-1.5"><Icon name="plus" size={13} /> Connect source</span>
                </button>{" "}
                to import your first source.
              </div>
            )}

            {/* file uploads row */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                uploadFiles(e.dataTransfer.files);
              }}
              className={`flex items-center gap-3.5 px-[18px] py-3.5 transition-colors ${
                dragOver ? "bg-teal-mist" : "bg-panel"
              }`}
            >
              <div className="grid h-[34px] w-[34px] flex-none place-items-center rounded-lg bg-up-chip text-sm font-bold text-up-ink">
                ⇪
              </div>
              <div className="min-w-0">
                <div className="text-[13px] font-semibold">File uploads</div>
                <div className="mt-px text-[11.5px] text-muted">
                  PDF, DOCX, TXT, MD — parsed, chunked & indexed
                  {uploadSource ? ` · ${uploadSource._count.documents} files` : ""}
                </div>
              </div>
              <button
                onClick={() => fileInput.current?.click()}
                disabled={uploading}
                className="ml-auto flex-none rounded-md border border-dashed border-teal-dash bg-card px-3 py-1.5 text-[11.5px] font-semibold text-teal hover:bg-teal-soft disabled:opacity-60"
              >
                {uploading ? "Processing…" : "⇪ Upload / drop files"}
              </button>
              <input
                ref={fileInput}
                type="file"
                multiple
                accept=".pdf,.docx,.txt,.md,.markdown"
                className="hidden"
                onChange={(e) => e.target.files && uploadFiles(e.target.files)}
              />
            </div>

            {/* manual entries row */}
            <div className="flex items-center gap-3.5 border-t border-hairline-2 bg-panel px-[18px] py-3.5">
              <SourceIcon type="manual" />
              <div className="min-w-0">
                <div className="text-[13px] font-semibold">Manual entries</div>
                <div className="mt-px text-[11.5px] text-muted">
                  Notes & docs written directly in Nonaki — chunked & indexed like
                  everything else
                  {manualSource ? ` · ${manualSource._count.documents} docs` : ""}
                </div>
              </div>
              <a
                href="/docs?new=1"
                className="ml-auto flex-none rounded-md border border-teal-line bg-card px-3 py-1.5 text-[11.5px] font-semibold text-teal hover:bg-teal-soft"
              >
                <span className="flex items-center gap-1.5"><Icon name="edit" size={12} /> New document</span>
              </a>
            </div>
          </div>

          <div className="mt-4 font-mono text-[10px] tracking-[0.08em] text-muted">
            COMING SOON
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {["Google Drive", "Slack", "Notion", "Zendesk", "Confluence"].map((n) => (
              <span
                key={n}
                className="cursor-not-allowed rounded-[7px] border border-edge bg-card px-3 py-1.5 text-[11.5px] text-faint"
              >
                <span className="flex items-center gap-0.5"><Icon name="plus" size={10} /> {n}</span>
              </span>
            ))}
          </div>
        </div>

        {/* right: index health + sync log */}
        <div className="flex w-[270px] flex-none flex-col gap-3.5">
          <div className="rounded-xl border border-line bg-card px-[18px] py-4">
            <div className="font-mono text-[10px] tracking-[0.08em] text-muted">INDEX HEALTH</div>
            <div className="mt-3 flex items-baseline gap-1.5">
              <span className="text-[26px] font-bold tracking-[-0.02em]">
                {stats.docs.toLocaleString()}
              </span>
              <span className="text-[11.5px] text-muted">docs indexed</span>
            </div>
            <div className="mt-1 text-[11px] text-faint">
              {stats.chunks.toLocaleString()} vector chunks in Weaviate
            </div>
            <SourceBar sources={sources} />
          </div>

          <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-card">
            <div className="flex flex-none items-center border-b border-hairline-2 px-[18px] py-3">
              <span className="font-mono text-[10px] tracking-[0.08em] text-muted">
                SYNC LOG
              </span>
              <span className="ml-auto font-mono text-[9px] text-faint">
                LAST {logs.length} EVENTS
              </span>
            </div>
            <div className="max-h-[420px] overflow-y-auto scrollbar-thin px-[18px] py-3">
              {!loaded && <TextSkeleton lines={7} />}
              {loaded && logs.length === 0 && (
                <div className="py-2 text-[11.5px] text-faint">
                  No activity yet — imports, syncs and edits are logged here.
                </div>
              )}
              <div className="flex flex-col gap-2.5 text-[11.5px] leading-[1.45] text-slate">
                {logs.map((l) => (
                  <div key={l.id} className="flex min-w-0 gap-2">
                    <span
                      className={`mt-[5px] h-1.5 w-1.5 flex-none rounded-full ${
                        l.level === "error"
                          ? "bg-orange"
                          : l.level === "warn"
                            ? "bg-amber"
                            : "bg-green"
                      }`}
                    />
                    <div className="min-w-0">
                      <span
                        className={`break-words ${l.level === "error" ? "text-orange" : ""}`}
                      >
                        {l.message}
                      </span>
                      <div
                        className="font-mono text-[9.5px] text-faint"
                        title={new Date(l.createdAt).toLocaleString()}
                      >
                        {timeAgo(l.createdAt)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
      <DeleteConfirmDialog
        open={confirmDisconnect !== null}
        title={`Disconnect "${confirmDisconnect?.name ?? ""}"?`}
        description={
          confirmDisconnect?.docs
            ? `This removes the source and its ${confirmDisconnect.docs} indexed document${
                confirmDisconnect.docs === 1 ? "" : "s"
              } from your knowledge base.`
            : "This removes the source from your knowledge base."
        }
        confirmLabel="Disconnect source"
        warning="All of this source's documents and their Weaviate chunks are deleted. Reconnecting later means a fresh import."
        tone="danger"
        onCancel={() => setConfirmDisconnect(null)}
        onConfirm={disconnect}
      />
    </>
  );
}

const BAR_COLORS = ["#0e7f93", "#58b0a4", "#3a5580", "#7a4a86", "#8aa3c0", "#c8ced2"];

function SourceBar({ sources }: { sources: Source[] }) {
  const withDocs = sources.filter((s) => s._count.documents > 0);
  const total = withDocs.reduce((sum, s) => sum + s._count.documents, 0);
  if (total === 0) return null;
  return (
    <>
      <div className="mt-2.5 flex h-1.5 overflow-hidden rounded-[3px] bg-track">
        {withDocs.map((s, i) => (
          <div
            key={s.id}
            style={{
              width: `${(s._count.documents / total) * 100}%`,
              background: BAR_COLORS[i % BAR_COLORS.length],
            }}
          />
        ))}
      </div>
      <div className="mt-2.5 flex flex-col gap-[5px] text-[11px] text-slate">
        {withDocs.map((s, i) => (
          <div key={s.id} className="flex items-center gap-[7px]">
            <span
              className="h-2 w-2 flex-none rounded-sm"
              style={{ background: BAR_COLORS[i % BAR_COLORS.length] }}
            />
            {s.name} {s._count.documents}
            <span className="ml-auto text-faint">
              {Math.round((s._count.documents / total) * 100)}%
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
