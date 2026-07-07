"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { NotionEditor } from "@/components/NotionEditor";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { VersionHistoryDialog } from "@/components/VersionHistoryDialog";
import { Skeleton, TextSkeleton } from "@/components/Skeleton";
import { TopStrip } from "@/components/Shell";
import { Icon } from "@/components/Icons";

type DocDetail = {
  id: string;
  title: string;
  content: string;
  kind: string;
  status: string;
  version: number;
  chunkCount: number;
  url: string | null;
  updatedAt: string;
  source: { name: string; type: string };
  proposals: { id: string; type: string; origin: string; reason: string | null }[];
  _count: { versions: number };
};

type ChatMsg = { role: "user" | "assistant"; text: string; proposalId?: string };

const SUGGESTIONS = [
  "Improve the writing and fix any typos",
  "Shorten this document by ~30%",
  "Rewrite this as a step-by-step guide",
];

export default function DocPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [doc, setDoc] = useState<DocDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [instruction, setInstruction] = useState("");
  const [drafting, setDrafting] = useState(false);
  const chatEnd = useRef<HTMLDivElement>(null);

  // edit mode
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<"archive" | "permanent" | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/documents/${id}`);
    if (!res.ok) {
      setNotFound(true);
      return;
    }
    const data = await res.json();
    setDoc(data.document);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat, drafting]);

  function startEdit() {
    if (!doc) return;
    setEditTitle(doc.title);
    setEditContent(doc.content);
    setEditing(true);
  }

  async function saveEdit() {
    if (!doc) return;
    setSaving(true);
    setFlash(null);
    try {
      const res = await fetch(`/api/documents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: editTitle, content: editContent }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setEditing(false);
      setFlash(
        data.chunks !== undefined
          ? `Saved — v${data.document.version}, re-chunked into ${data.chunks} and re-indexed in Weaviate ✓`
          : "No changes."
      );
      await load();
    } catch (err) {
      setFlash(`Save failed: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally {
      setSaving(false);
    }
  }

  async function deleteDoc() {
    if (!doc || !confirmDelete) return;
    const permanent = confirmDelete === "permanent";
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/documents/${id}${permanent ? "?permanent=1" : ""}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Delete failed");
      }
      if (permanent) {
        router.push("/docs");
      } else {
        setConfirmDelete(null);
        setFlash("Archived — removed from the index. You can restore it any time.");
        await load();
      }
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }

  async function restoreDoc() {
    if (!doc) return;
    setRestoring(true);
    setFlash(null);
    try {
      const res = await fetch(`/api/documents/${id}/restore`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Restore failed");
      setFlash(`Restored — re-indexed into ${data.chunks} chunks ✓`);
      await load();
    } catch (err) {
      setFlash(`Restore failed: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally {
      setRestoring(false);
    }
  }

  async function draft(text?: string) {
    const inst = (text ?? instruction).trim();
    if (!inst || drafting) return;
    setInstruction("");
    setChat((c) => [...c, { role: "user", text: inst }]);
    setDrafting(true);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId: id, instruction: inst }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Draft failed");
      setChat((c) => [
        ...c,
        {
          role: "assistant",
          text: "I drafted a revision and queued it in the review queue — nothing publishes until you approve it.",
          proposalId: data.proposal.id,
        },
      ]);
      await load();
    } catch (err) {
      setChat((c) => [
        ...c,
        {
          role: "assistant",
          text: `Couldn't draft that: ${err instanceof Error ? err.message : "unknown error"}`,
        },
      ]);
    } finally {
      setDrafting(false);
    }
  }

  if (notFound) {
    return (
      <>
        <TopStrip crumb="Nonaki / Documents" />
        <div className="grid flex-1 place-items-center text-sm text-muted">
          Document not found.{" "}
          <Link href="/docs" className="ml-1 text-teal">
            Back to documents
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <TopStrip
        crumb={`Nonaki / Documents / ${doc?.title ?? "…"}`}
        right={
          doc ? (
            <span className="text-green">
              v{doc.version} · {doc.chunkCount} CHUNKS INDEXED
            </span>
          ) : undefined
        }
      />

      {/* doc toolbar */}
      <div className="flex flex-none items-center gap-2.5 border-b border-hairline px-6 py-2.5">
        <Link href="/docs" className="text-xs text-muted hover:text-ink">
          Documents
        </Link>
        <span className="text-ghost">›</span>
        <span className="text-xs font-semibold">{doc?.title ?? "…"}</span>
        {doc && !editing && doc.status === "archived" && (
          <span className="flex items-center gap-1 rounded-[5px] bg-chip px-2 py-0.5 text-[10.5px] font-semibold text-muted">
            <Icon name="archive" size={11} /> Archived — not searchable
          </span>
        )}
        {doc && !editing && doc.status !== "archived" && (
          <span className="rounded-[5px] bg-green-soft px-2 py-0.5 text-[10.5px] font-semibold text-green">
            ✓ Indexed ·{" "}
            {new Date(doc.updatedAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}
          </span>
        )}
        {editing && (
          <span className="rounded-[5px] bg-amber-soft px-2 py-0.5 text-[10.5px] font-semibold text-amber">
            EDITING — saving re-indexes Weaviate
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {doc?.url && !editing && (
            <a
              href={doc.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 rounded-md border border-teal-line bg-card px-3 py-1 text-[11.5px] font-semibold text-teal hover:bg-teal-soft"
            >
              View source <Icon name="external" size={11} />
            </a>
          )}
          {doc && !editing && (
            <button
              onClick={() => setHistoryOpen(true)}
              className="flex items-center gap-1.5 rounded-md border border-line bg-card px-3 py-1 text-[11.5px] font-semibold text-slate hover:border-teal hover:text-teal"
            >
              <Icon name="history" size={12} /> History{doc._count.versions > 0 ? ` (${doc._count.versions})` : ""}
            </button>
          )}
          {doc && !editing && doc.status === "archived" && (
            <>
              <button
                onClick={restoreDoc}
                disabled={restoring}
                className="flex items-center gap-1.5 rounded-md bg-teal px-3.5 py-1 text-[11.5px] font-semibold text-white hover:bg-teal-dark disabled:opacity-60"
              >
                {!restoring && <Icon name="restore" size={12} />}
                {restoring ? "Restoring…" : "Restore to index"}
              </button>
              <button
                onClick={() => {
                  setDeleteError(null);
                  setConfirmDelete("permanent");
                }}
                className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] font-semibold text-muted hover:text-diff-del-line"
              >
                <Icon name="trash" size={12} /> Delete permanently
              </button>
            </>
          )}
          {doc && !editing && doc.status !== "archived" && (
            <>
              <button
                onClick={startEdit}
                className="flex items-center gap-1.5 rounded-md border border-teal-line bg-card px-3 py-1 text-[11.5px] font-semibold text-teal hover:bg-teal-soft"
              >
                <Icon name="edit" size={12} /> Edit
              </button>
              <button
                onClick={() => {
                  setDeleteError(null);
                  setConfirmDelete("archive");
                }}
                className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] font-semibold text-muted hover:text-diff-del-line"
              >
                <Icon name="archive" size={12} /> Archive
              </button>
            </>
          )}
          {editing && (
            <>
              <button
                onClick={saveEdit}
                disabled={saving || !editContent.trim()}
                className="rounded-md bg-teal px-3.5 py-1 text-[11.5px] font-semibold text-white hover:bg-teal-dark disabled:opacity-60"
              >
                {saving ? "Saving & re-indexing…" : "Save & re-index"}
              </button>
              <button
                onClick={() => setEditing(false)}
                disabled={saving}
                className="rounded-md px-2 py-1 text-[11.5px] text-muted hover:text-ink"
              >
                Cancel
              </button>
            </>
          )}
        </span>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* editor column */}
        <div className="flex min-w-0 flex-1 justify-center overflow-y-auto scrollbar-thin px-10 pt-9">
          <div className="flex w-[660px] max-w-full flex-col pb-16">
            {editing ? (
              <input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder="Untitled"
                className="w-full bg-transparent text-[30px] font-bold tracking-[-0.02em] outline-none placeholder:text-ghost"
              />
            ) : doc ? (
              <h1 className="text-[30px] font-bold tracking-[-0.02em]">{doc.title}</h1>
            ) : (
              <Skeleton className="h-9 w-2/3 rounded-lg" />
            )}
            {doc && !editing && (
              <div className="mt-2 flex gap-3.5 text-[11.5px] text-faint">
                <span>From {doc.source.name}</span>
                <span className="uppercase">{doc.kind}</span>
                <span>v{doc.version}</span>
              </div>
            )}

            {flash && (
              <div className="mt-3 rounded-lg border border-green-soft bg-green-soft px-3 py-2 text-[11.5px] text-green-deep">
                {flash}
              </div>
            )}

            {/* drift banner */}
            {doc && !editing && doc.proposals.length > 0 && (
              <div className="mt-4 flex items-center gap-2.5 rounded-lg border border-warn-line bg-warn-bg px-3.5 py-2.5 text-[11.5px] leading-[1.5] text-warn-text">
                <span className="h-[7px] w-[7px] flex-none rounded-full bg-orange" />
                <div>
                  <b>Pending change:</b>{" "}
                  {doc.proposals[0].reason ?? "an update is waiting for review."}
                </div>
                <Link
                  href="/review"
                  className="ml-auto flex-none text-[11px] font-semibold text-teal hover:text-teal-dark"
                >
                  Review diff →
                </Link>
              </div>
            )}

            {editing ? (
              <NotionEditor
                value={editContent}
                onChange={setEditContent}
                title={editTitle}
                autoFocus
                wrapperClassName="mt-5 min-h-[420px] flex-1"
                contentClassName="min-h-[380px] pb-24"
              />
            ) : doc ? (
              <NotionEditor key={doc.version} value={doc.content} readOnly wrapperClassName="mt-6" />
            ) : (
              <TextSkeleton lines={14} className="mt-8" />
            )}
          </div>
        </div>

        {/* assistant panel */}
        <div className="flex w-[300px] flex-none flex-col border-l border-hairline bg-panel">
          <div className="flex items-center gap-2 border-b border-hairline px-4 py-3">
            <span className="text-[13px] text-teal">✦</span>
            <span className="text-[12.5px] font-semibold">Assistant</span>
            <span className="ml-auto rounded bg-chip px-1.5 py-0.5 font-mono text-[9px] text-muted">
              THIS DOC
            </span>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto scrollbar-thin px-4 py-3.5">
            {chat.length === 0 && (
              <div className="flex flex-col gap-2">
                <div className="text-[11px] leading-relaxed text-muted">
                  Ask me to revise this document. Drafts go to the review queue
                  — nothing publishes until you approve it.
                </div>
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => draft(s)}
                    className="rounded-lg border border-edge bg-card px-3 py-2 text-left text-[11.5px] text-slate hover:border-teal hover:text-teal"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            {chat.map((m, i) =>
              m.role === "user" ? (
                <div
                  key={i}
                  className="max-w-[88%] self-end rounded-[11px] rounded-br-[3px] bg-teal px-3 py-2 text-xs leading-[1.55] text-white"
                >
                  {m.text}
                </div>
              ) : (
                <div
                  key={i}
                  className="max-w-[94%] self-start rounded-[11px] rounded-bl-[3px] border border-line bg-card px-3 py-2.5 text-xs leading-[1.6] text-body"
                >
                  {m.text}
                  {m.proposalId && (
                    <div className="mt-2 flex gap-2">
                      <Link
                        href="/review"
                        className="rounded-md bg-teal px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-teal-dark"
                      >
                        Review diff
                      </Link>
                    </div>
                  )}
                </div>
              )
            )}
            {drafting && (
              <div className="flex items-center gap-2 self-start rounded-[11px] rounded-bl-[3px] border border-line bg-card px-3 py-2.5 text-xs text-muted">
                <span className="pulse-dot text-teal">✦</span> Drafting a revision…
              </div>
            )}
            <div ref={chatEnd} />
          </div>

          <div className="border-t border-hairline px-3.5 py-3">
            <div className="flex items-center gap-2 rounded-[9px] border border-edge bg-card px-3 py-2 focus-within:border-teal">
              <span className="text-xs text-teal">✦</span>
              <input
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && draft()}
                placeholder="Ask or give a command…"
                disabled={drafting || !doc}
                className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-faint"
              />
              <span className="font-mono text-[9.5px] text-ghost">↵</span>
            </div>
          </div>
        </div>
      </div>

      <DeleteConfirmDialog
        open={confirmDelete !== null}
        title={
          confirmDelete === "permanent"
            ? `Permanently delete "${doc?.title ?? "this document"}"?`
            : `Archive "${doc?.title ?? "this document"}"?`
        }
        description={
          confirmDelete === "permanent"
            ? "This removes the document, its version history and its indexed chunks for good."
            : "This removes the document from search, but keeps it so you can restore it later."
        }
        confirmLabel={confirmDelete === "permanent" ? "Delete permanently" : "Archive document"}
        warning={
          confirmDelete === "permanent"
            ? "This cannot be undone — the content, version history and Weaviate chunks are permanently removed."
            : "The document stops appearing in answers and search immediately. Restore it any time from this page or the Documents list."
        }
        tone={confirmDelete === "permanent" ? "danger" : "archive"}
        requireText={confirmDelete === "permanent" ? "DELETE" : undefined}
        loading={deleting}
        error={deleteError}
        onCancel={() => {
          if (deleting) return;
          setConfirmDelete(null);
          setDeleteError(null);
        }}
        onConfirm={deleteDoc}
      />
      {doc && (
        <VersionHistoryDialog
          documentId={doc.id}
          currentTitle={doc.title}
          currentVersion={doc.version}
          currentContent={doc.content}
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
          onRestored={() => {
            setFlash("Rolled back — the snapshot was published as a new version ✓");
            load();
          }}
        />
      )}
    </>
  );
}
