"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { TopStrip, useStats } from "@/components/Shell";
import { ListRowsSkeleton, TextSkeleton } from "@/components/Skeleton";
import { diffLines, diffHunks, applyHunks } from "@/lib/diff";

type Proposal = {
  id: string;
  type: string;
  origin: string;
  reason: string | null;
  oldContent: string;
  newContent: string;
  newTitle: string | null;
  status: string;
  createdAt: string;
  resolvedAt: string | null;
  document: {
    id: string;
    title: string;
    version: number;
    source: { id: string; name: string; type: string };
  };
};

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "JUST NOW";
  if (s < 3600) return `${Math.floor(s / 60)} MIN AGO`;
  if (s < 86400) return `${Math.floor(s / 3600)} H AGO`;
  return `${Math.floor(s / 86400)} D AGO`;
}

const TYPE_BADGE: Record<string, { label: string; cls: string }> = {
  update: { label: "UPDATE", cls: "text-teal bg-chip" },
  archive: { label: "ARCHIVE", cls: "text-[#8a5a2c] bg-amber-soft" },
};

export default function ReviewPage() {
  const { refresh } = useStats();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [sectionMode, setSectionMode] = useState(false);
  const [acceptedHunks, setAcceptedHunks] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    const data = await fetch("/api/proposals").then((r) => r.json());
    setProposals(data.proposals ?? []);
    setLoaded(true);
    refresh();
  }, [refresh]);

  useEffect(() => {
    load();
  }, [load]);

  const pending = proposals.filter((p) => p.status === "pending");
  const resolved = proposals.filter((p) => p.status !== "pending").slice(0, 10);
  const selected =
    pending.find((p) => p.id === selectedId) ?? pending[0] ?? null;

  const hunks = useMemo(() => {
    if (!selected || selected.type === "archive") return null;
    return diffHunks(selected.oldContent, selected.newContent);
  }, [selected]);

  const changeHunkIndexes = useMemo(
    () =>
      (hunks ?? [])
        .map((h, i) => (h.type === "change" ? i : -1))
        .filter((i) => i >= 0),
    [hunks]
  );

  useEffect(() => {
    setEditing(false);
    setSectionMode(false);
    setDraft(selected?.newContent ?? "");
    setAcceptedHunks(new Set(changeHunkIndexes)); // default: everything accepted
  }, [selected?.id, selected?.newContent, changeHunkIndexes]);

  const diff = useMemo(() => {
    if (!selected || selected.type === "archive") return null;
    return diffLines(selected.oldContent, editing ? draft : selected.newContent);
  }, [selected, editing, draft]);

  const partial = sectionMode && acceptedHunks.size < changeHunkIndexes.length;

  async function resolve(action: "approve" | "reject") {
    if (!selected) return;
    // Section mode with nothing accepted = keep the old content = a reject
    if (action === "approve" && sectionMode && acceptedHunks.size === 0) {
      action = "reject";
    }
    setActing(action);
    try {
      const newContent =
        action !== "approve"
          ? undefined
          : editing
            ? draft
            : sectionMode && hunks && partial
              ? applyHunks(hunks, acceptedHunks)
              : undefined;
      const res = await fetch(`/api/proposals/${selected.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(newContent !== undefined ? { newContent } : {}) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error ?? "Failed to resolve proposal");
      }
      setSelectedId(null);
      await load();
    } finally {
      setActing(null);
    }
  }

  const sameSourcePending = selected
    ? pending.filter(
        (p) => p.document.source.id === selected.document.source.id && p.origin === "sync"
      )
    : [];

  async function approveAllFromSource() {
    if (!selected || sameSourcePending.length === 0) return;
    const name = selected.document.source.name;
    if (
      !confirm(
        `Approve all ${sameSourcePending.length} pending sync proposals from "${name}"? Each one publishes and re-indexes immediately.`
      )
    ) {
      return;
    }
    setActing("bulk");
    try {
      const res = await fetch("/api/proposals/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", sourceId: selected.document.source.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error ?? "Bulk approve failed");
      } else if (data.errors?.length) {
        alert(`${data.resolved} approved · ${data.errors.length} failed`);
      }
      setSelectedId(null);
      await load();
    } finally {
      setActing(null);
    }
  }

  return (
    <>
      <TopStrip
        crumb="Nonaki / Review Queue"
        right={
          <span className={pending.length ? "text-amber" : ""}>
            {pending.length
              ? `${pending.length} PROPOSAL${pending.length > 1 ? "S" : ""} WAITING`
              : "QUEUE CLEAR"}
          </span>
        }
      />
      <div className="flex min-h-0 flex-1">
        {/* proposal list */}
        <div className="flex w-[296px] flex-none flex-col overflow-hidden border-r border-hairline">
          <div className="px-4 pb-2.5 pt-4">
            <div className="text-[15px] font-semibold">Review queue</div>
            <div className="mt-0.5 text-[11.5px] leading-[1.45] text-muted">
              Nothing publishes to the index until you approve it.
            </div>
          </div>
          <div className="flex min-h-0 flex-col overflow-y-auto scrollbar-thin">
            {!loaded && <ListRowsSkeleton rows={4} icon={false} />}
            {pending.map((p) => {
              const badge = TYPE_BADGE[p.type] ?? TYPE_BADGE.update;
              const active = selected?.id === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  className={`border-b border-row-line px-4 py-3 text-left ${
                    active
                      ? "border-l-[3px] border-l-teal bg-teal-wash"
                      : "border-l-[3px] border-l-transparent hover:bg-hover"
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`flex-none rounded px-[5px] py-0.5 font-mono text-[8.5px] ${badge.cls}`}
                    >
                      {badge.label}
                    </span>
                    <span className="truncate text-[12.5px] font-semibold">
                      {p.document.title}
                    </span>
                  </div>
                  <div className="mt-[5px] line-clamp-2 text-[11px] leading-[1.45] text-dim">
                    {p.reason}
                  </div>
                  <div className="mt-[5px] font-mono text-[10px] uppercase text-faint">
                    {p.origin === "sync"
                      ? p.document.source.name
                      : p.origin === "assistant"
                        ? "AI Assistant"
                        : "Manual edit"}{" "}
                    · {timeAgo(p.createdAt)}
                  </div>
                </button>
              );
            })}
            {loaded && pending.length === 0 && (
              <div className="px-4 py-6 text-xs leading-relaxed text-muted">
                No pending proposals. Re-sync a WordPress source or ask the doc
                assistant to draft an update — changes land here for approval.
              </div>
            )}
          </div>
          {resolved.length > 0 && (
            <div className="mt-auto border-t border-hairline px-4 py-3 text-[11px] leading-6 text-muted">
              {resolved.slice(0, 3).map((p) => (
                <div key={p.id} className="flex items-center gap-1.5 truncate">
                  <span className={p.status === "approved" ? "text-green" : "text-faint"}>
                    {p.status === "approved" ? "✓" : "✕"}
                  </span>
                  <span className="truncate">{p.document.title}</span>
                  <span className="ml-auto flex-none font-mono text-[9px] uppercase text-faint">
                    {p.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* diff view */}
        {selected ? (
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <div className="px-6 pt-4">
              <div className="flex items-center gap-2.5">
                <div className="text-[17px] font-semibold tracking-[-0.01em]">
                  {selected.newTitle ?? selected.document.title}
                </div>
                <span className="rounded-[5px] bg-green-soft px-2 py-0.5 text-[10.5px] font-semibold text-green">
                  v{selected.document.version} indexed
                </span>
                <span className="text-[11px] text-muted">
                  {selected.document.source.name} · {selected.origin} proposal
                </span>
              </div>
              <div className="mt-2.5 flex items-center gap-2.5 rounded-[9px] border border-warn-line bg-warn-bg px-3.5 py-2.5 text-xs leading-[1.5] text-warn-text">
                <span className="h-2 w-2 flex-none rounded-full bg-orange" />
                <div>
                  <b>
                    {selected.type === "archive" ? "Archive proposed:" : "Drift detected:"}
                  </b>{" "}
                  {selected.reason}
                </div>
              </div>
            </div>

            {selected.type === "archive" ? (
              <div className="min-h-0 flex-1 overflow-hidden px-6 py-3.5">
                <div className="flex h-full flex-col overflow-hidden rounded-[10px] border border-line bg-card">
                  <div className="border-b border-hairline-2 px-3.5 py-2 font-mono text-[9.5px] tracking-[0.08em] text-muted">
                    CURRENT · v{selected.document.version} — WILL BE REMOVED FROM THE INDEX
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin whitespace-pre-wrap px-4 py-3.5 text-xs leading-[1.7] text-slate line-through decoration-diff-del-line">
                    {selected.oldContent}
                  </div>
                </div>
              </div>
            ) : sectionMode && hunks ? (
              <div className="min-h-0 flex-1 overflow-hidden px-6 py-3.5">
                <div className="flex h-full flex-col overflow-hidden rounded-[10px] border-[1.5px] border-teal bg-card">
                  <div className="flex items-center gap-2 border-b border-teal-hairline bg-teal-mist px-3.5 py-2 font-mono text-[9.5px] tracking-[0.08em] text-teal">
                    PICK SECTIONS · {acceptedHunks.size} OF {changeHunkIndexes.length} CHANGES
                    ACCEPTED
                    <button
                      onClick={() => setAcceptedHunks(new Set(changeHunkIndexes))}
                      className="ml-auto rounded border border-teal-line bg-card px-1.5 py-px text-[9px] font-semibold text-teal hover:bg-teal-soft"
                    >
                      ALL
                    </button>
                    <button
                      onClick={() => setAcceptedHunks(new Set())}
                      className="rounded border border-teal-line bg-card px-1.5 py-px text-[9px] font-semibold text-teal hover:bg-teal-soft"
                    >
                      NONE
                    </button>
                    <button
                      onClick={() => setSectionMode(false)}
                      className="rounded border border-teal-line bg-card px-1.5 py-px text-[9px] font-semibold text-teal hover:bg-teal-soft"
                    >
                      DONE
                    </button>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin px-4 py-3 text-xs leading-[1.7] text-slate">
                    {hunks.map((hunk, index) =>
                      hunk.type === "same" ? (
                        <div key={index} className="text-faint">
                          {hunk.lines.length > 6 ? (
                            <>
                              {hunk.lines.slice(0, 2).map((l, i) => (
                                <div key={`h${i}`}>{l || " "}</div>
                              ))}
                              <div className="my-0.5 font-mono text-[9.5px] tracking-[0.06em]">
                                ⋯ {hunk.lines.length - 4} unchanged lines ⋯
                              </div>
                              {hunk.lines.slice(-2).map((l, i) => (
                                <div key={`t${i}`}>{l || " "}</div>
                              ))}
                            </>
                          ) : (
                            hunk.lines.map((l, i) => <div key={i}>{l || " "}</div>)
                          )}
                        </div>
                      ) : (
                        <label
                          key={index}
                          className={`my-1.5 block cursor-pointer overflow-hidden rounded-lg border transition-colors ${
                            acceptedHunks.has(index)
                              ? "border-teal bg-card"
                              : "border-edge bg-panel opacity-75"
                          }`}
                        >
                          <span className="flex items-center gap-2 border-b border-hairline-2 px-3 py-1.5">
                            <input
                              type="checkbox"
                              checked={acceptedHunks.has(index)}
                              onChange={(e) => {
                                const next = new Set(acceptedHunks);
                                if (e.target.checked) next.add(index);
                                else next.delete(index);
                                setAcceptedHunks(next);
                              }}
                              className="h-3.5 w-3.5 accent-[#0e7f93]"
                            />
                            <span className="font-mono text-[9px] uppercase tracking-[0.06em] text-muted">
                              {acceptedHunks.has(index)
                                ? "Accept this change"
                                : "Keeping the current text"}
                            </span>
                          </span>
                          <span className="block px-3 py-1.5">
                            {hunk.oldLines.map((l, i) => (
                              <span
                                key={`o${i}`}
                                className="block bg-diff-del line-through decoration-diff-del-line"
                              >
                                {l || " "}
                              </span>
                            ))}
                            {hunk.newLines.map((l, i) => (
                              <span key={`n${i}`} className="block bg-diff-add">
                                {l || " "}
                              </span>
                            ))}
                          </span>
                        </label>
                      )
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 gap-3.5 px-6 py-3.5">
                <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[10px] border border-line bg-card">
                  <div className="border-b border-hairline-2 px-3.5 py-2 font-mono text-[9.5px] tracking-[0.08em] text-muted">
                    CURRENT · v{selected.document.version}
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin px-4 py-3.5 text-xs leading-[1.7] text-slate">
                    {diff?.left.map((line, i) => (
                      <div
                        key={i}
                        className={
                          line.type === "del"
                            ? "bg-diff-del line-through decoration-diff-del-line"
                            : ""
                        }
                      >
                        {line.text || " "}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[10px] border-[1.5px] border-teal bg-card shadow-[0_4px_14px_rgba(14,127,147,0.08)]">
                  <div className="flex items-center border-b border-teal-hairline bg-teal-mist px-3.5 py-2 font-mono text-[9.5px] tracking-[0.08em] text-teal">
                    PROPOSED ·{" "}
                    {selected.origin === "assistant"
                      ? "DRAFTED BY AI"
                      : selected.origin === "sync"
                        ? "FROM SOURCE SYNC"
                        : "MANUAL EDIT"}
                    {changeHunkIndexes.length > 1 && !editing && (
                      <button
                        onClick={() => setSectionMode(true)}
                        title="Accept or reject each changed section individually"
                        className="ml-auto rounded border border-teal-line bg-card px-1.5 py-px text-[9px] font-semibold text-teal hover:bg-teal-soft"
                      >
                        PICK SECTIONS
                      </button>
                    )}
                    <button
                      onClick={() => setEditing((v) => !v)}
                      className={`rounded border border-teal-line bg-card px-1.5 py-px text-[9px] font-semibold text-teal hover:bg-teal-soft ${
                        changeHunkIndexes.length > 1 && !editing ? "" : "ml-auto"
                      }`}
                    >
                      {editing ? "DONE" : "EDIT DRAFT"}
                    </button>
                  </div>
                  {editing ? (
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      className="min-h-0 flex-1 resize-none px-4 py-3.5 font-mono text-[11px] leading-[1.7] text-slate outline-none"
                    />
                  ) : (
                    <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin px-4 py-3.5 text-xs leading-[1.7] text-slate">
                      {diff?.right.map((line, i) => (
                        <div key={i} className={line.type === "add" ? "bg-diff-add" : ""}>
                          {line.text || " "}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="flex flex-none items-center gap-2.5 border-t border-hairline px-6 py-3">
              <button
                onClick={() => resolve("approve")}
                disabled={acting !== null}
                className="rounded-[7px] bg-teal px-[18px] py-2 text-[12.5px] font-semibold text-white hover:bg-teal-dark disabled:opacity-60"
              >
                {acting === "approve"
                  ? "Publishing…"
                  : selected.type === "archive"
                    ? "✓ Approve & archive"
                    : partial
                      ? `✓ Approve ${acceptedHunks.size} of ${changeHunkIndexes.length} sections`
                      : "✓ Approve & publish"}
              </button>
              <button
                onClick={() => resolve("reject")}
                disabled={acting !== null}
                className="rounded-[7px] px-2.5 py-2 text-[12.5px] text-muted hover:text-ink disabled:opacity-60"
              >
                Reject
              </button>
              {sameSourcePending.length > 1 && (
                <button
                  onClick={approveAllFromSource}
                  disabled={acting !== null}
                  title="Approve every pending sync proposal from this source"
                  className="rounded-[7px] border border-teal-line bg-card px-3 py-2 text-[12px] font-semibold text-teal hover:bg-teal-soft disabled:opacity-60"
                >
                  {acting === "bulk"
                    ? "Approving all…"
                    : `✓✓ Approve all ${sameSourcePending.length} from ${selected.document.source.name}`}
                </button>
              )}
              <span className="ml-auto text-[11px] text-faint">
                {selected.type === "archive"
                  ? "Approving removes this document's chunks from Weaviate"
                  : partial
                    ? "Unchecked sections keep the currently indexed text"
                    : "Approving bumps the version, re-chunks and re-indexes in Weaviate"}
              </span>
            </div>
          </div>
        ) : !loaded ? (
          <div className="flex min-w-0 flex-1 flex-col px-6 py-4">
            <TextSkeleton lines={2} className="max-w-[420px]" />
            <div className="mt-4 flex min-h-0 flex-1 gap-3.5">
              <div className="min-w-0 flex-1 rounded-[10px] border border-line bg-card p-4">
                <TextSkeleton lines={11} />
              </div>
              <div className="min-w-0 flex-1 rounded-[10px] border border-line bg-card p-4">
                <TextSkeleton lines={11} />
              </div>
            </div>
          </div>
        ) : (
          <div className="grid flex-1 place-items-center text-sm text-muted">
            The review queue is clear ✓
          </div>
        )}
      </div>
    </>
  );
}
