"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ListRowsSkeleton, TextSkeleton } from "@/components/Skeleton";
import { diffLines } from "@/lib/diff";

type VersionMeta = {
  id: string;
  version: number;
  title: string;
  origin: string;
  createdAt: string;
};

const ORIGIN_LABEL: Record<string, string> = {
  edit: "Manual edit",
  proposal: "Approved proposal",
  sync: "Source sync",
  restore: "Rollback",
};

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

/**
 * Version history browser: pick a snapshot, see what changed vs the current
 * content, roll back if needed.
 */
export function VersionHistoryDialog({
  documentId,
  currentTitle,
  currentVersion,
  currentContent,
  open,
  onClose,
  onRestored,
}: {
  documentId: string;
  currentTitle: string;
  currentVersion: number;
  currentContent: string;
  open: boolean;
  onClose: () => void;
  onRestored: () => void;
}) {
  const [versions, setVersions] = useState<VersionMeta[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null); // selected version's content
  const [loaded, setLoaded] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoaded(false);
    setSelectedId(null);
    setContent(null);
    setError(null);
    fetch(`/api/documents/${documentId}/versions`)
      .then((r) => r.json())
      .then((d) => {
        setVersions(d.versions ?? []);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [open, documentId]);

  const select = useCallback(
    async (v: VersionMeta) => {
      setSelectedId(v.id);
      setContent(null);
      setError(null);
      try {
        const data = await fetch(`/api/documents/${documentId}/versions/${v.id}`).then((r) =>
          r.json()
        );
        setContent(data.version?.content ?? "");
      } catch {
        setError("Could not load this version");
      }
    },
    [documentId]
  );

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !restoring) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, restoring, onClose]);

  const selected = versions.find((v) => v.id === selectedId) ?? null;

  const diff = useMemo(() => {
    if (!selected || content === null) return null;
    // old = the snapshot, new = current doc
    return diffLines(content, currentContent);
  }, [selected, content, currentContent]);

  async function restore() {
    if (!selected) return;
    setRestoring(true);
    setError(null);
    try {
      const res = await fetch(`/api/documents/${documentId}/versions/${selected.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Restore failed");
      onRestored();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Restore failed");
    } finally {
      setRestoring(false);
    }
  }

  if (!open) return null;

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-[80] grid place-items-center bg-black/35 px-4 py-8 backdrop-blur-[2px]"
      onMouseDown={() => {
        if (!restoring) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="flex h-[620px] max-h-full w-[920px] max-w-full flex-col overflow-hidden rounded-lg border border-line bg-card shadow-[0_18px_60px_rgba(10,20,25,0.28)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex flex-none items-center gap-2.5 border-b border-hairline px-5 py-3.5">
          <span className="text-[13px] text-teal">⟲</span>
          <div className="min-w-0">
            <div className="truncate text-[14px] font-semibold">
              Version history — {currentTitle}
            </div>
            <div className="text-[11px] text-muted">
              Currently at v{currentVersion} · older versions are kept every time the
              content changes
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={restoring}
            className="ml-auto rounded-md px-2 py-1 text-[13px] text-muted hover:text-ink"
          >
            ✕
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* version list */}
          <div className="flex w-[250px] flex-none flex-col overflow-y-auto scrollbar-thin border-r border-hairline">
            {!loaded && <ListRowsSkeleton rows={4} icon={false} />}
            {versions.map((v) => (
              <button
                key={v.id}
                onClick={() => select(v)}
                className={`border-b border-row-line px-4 py-3 text-left ${
                  selectedId === v.id
                    ? "border-l-[3px] border-l-teal bg-teal-wash"
                    : "border-l-[3px] border-l-transparent hover:bg-hover"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="rounded bg-chip px-1.5 py-px font-mono text-[9px] text-muted">
                    v{v.version}
                  </span>
                  <span className="truncate text-[12px] font-semibold">{v.title}</span>
                </div>
                <div className="mt-1 font-mono text-[9.5px] uppercase text-faint">
                  {ORIGIN_LABEL[v.origin] ?? v.origin} · {timeAgo(v.createdAt)}
                </div>
              </button>
            ))}
            {loaded && versions.length === 0 && (
              <div className="px-4 py-6 text-xs leading-relaxed text-muted">
                No previous versions yet — a snapshot is kept every time this
                document&apos;s content changes.
              </div>
            )}
          </div>

          {/* diff: selected version (left) vs current (right) */}
          {selected && diff ? (
            <div className="flex min-w-0 flex-1 gap-3 overflow-hidden p-4">
              <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[10px] border border-line bg-card">
                <div className="border-b border-hairline-2 px-3.5 py-2 font-mono text-[9.5px] tracking-[0.08em] text-muted">
                  SNAPSHOT · v{selected.version} · {timeAgo(selected.createdAt).toUpperCase()}
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin px-4 py-3 text-xs leading-[1.7] text-slate">
                  {diff.left.map((line, i) => (
                    <div
                      key={i}
                      className={
                        line.type === "del"
                          ? "bg-diff-del line-through decoration-diff-del-line"
                          : ""
                      }
                    >
                      {line.text || " "}
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[10px] border border-line bg-card">
                <div className="border-b border-hairline-2 px-3.5 py-2 font-mono text-[9.5px] tracking-[0.08em] text-teal">
                  CURRENT · v{currentVersion}
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin px-4 py-3 text-xs leading-[1.7] text-slate">
                  {diff.right.map((line, i) => (
                    <div key={i} className={line.type === "add" ? "bg-diff-add" : ""}>
                      {line.text || " "}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : selected ? (
            <div className="flex min-w-0 flex-1 gap-3 overflow-hidden p-4">
              <div className="min-w-0 flex-1 rounded-[10px] border border-line bg-card p-4">
                <TextSkeleton lines={9} />
              </div>
              <div className="min-w-0 flex-1 rounded-[10px] border border-line bg-card p-4">
                <TextSkeleton lines={9} />
              </div>
            </div>
          ) : (
            <div className="grid flex-1 place-items-center text-xs text-muted">
              {versions.length > 0
                ? "Select a version to compare it with the current content."
                : ""}
            </div>
          )}
        </div>

        <div className="flex flex-none items-center gap-2.5 border-t border-hairline px-5 py-3">
          {error && <span className="text-[11.5px] text-orange">{error}</span>}
          <span className="ml-auto text-[11px] text-faint">
            Restoring publishes the snapshot as a new version and re-indexes Weaviate
          </span>
          <button
            onClick={restore}
            disabled={!selected || content === null || restoring}
            className="rounded-[7px] bg-teal px-4 py-2 text-xs font-semibold text-white hover:bg-teal-dark disabled:opacity-50"
          >
            {restoring
              ? "Restoring…"
              : selected
                ? `⟲ Restore v${selected.version}`
                : "⟲ Restore"}
          </button>
        </div>
      </div>
    </div>
  );
}
