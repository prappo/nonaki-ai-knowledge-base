"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { NotionEditor } from "@/components/NotionEditor";
import { Icon } from "@/components/Icons";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { SourceSelect } from "@/components/SourceSelect";
import { FilterSelect } from "@/components/FilterSelect";
import { ListRowsSkeleton } from "@/components/Skeleton";
import { TopStrip, useStats } from "@/components/Shell";

type Doc = {
  id: string;
  title: string;
  excerpt: string | null;
  kind: string;
  status: string;
  verified: boolean;
  version: number;
  chunkCount: number;
  updatedAt: string;
  source: { id: string; name: string; type: string };
  _count: { proposals: number };
};

type SourceInfo = { id: string; name: string; type: string; siteUrl?: string };

type PendingDelete =
  | { type: "single"; id: string; title: string; permanent: boolean }
  | { type: "bulk"; count: number; permanent: boolean };

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

const PER_PAGE_OPTIONS = [25, 50, 100];

const FILE_KINDS = new Set(["pdf", "docx", "txt", "md"]);
const kindLabel = (kind: string) =>
  FILE_KINDS.has(kind) ? kind.toUpperCase() : kind.charAt(0).toUpperCase() + kind.slice(1);

export default function DocsPage() {
  const router = useRouter();
  const { refresh } = useStats();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [filter, setFilter] = useState("");
  const [query, setQuery] = useState(""); // debounced value actually sent
  const [kind, setKind] = useState(""); // "" = all types
  const [kinds, setKinds] = useState<{ kind: string; count: number }[]>([]);
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [status, setStatus] = useState(""); // "" | indexed | archived
  const [verified, setVerified] = useState(""); // "" | "1" | "0"
  const [drift, setDrift] = useState(false);
  const [updatedWithin, setUpdatedWithin] = useState("");
  const [minChunks, setMinChunks] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [restoringIds, setRestoringIds] = useState<Set<string>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // manual composer
  const [composeOpen, setComposeOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // /docs?new=1 (e.g. from the Sources page) opens the composer directly
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("new") === "1") {
      setComposeOpen(true);
    }
  }, []);

  async function createDoc() {
    if (!newTitle.trim() || !newContent.trim() || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle, content: newContent }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not create the document");
      refresh();
      router.push(`/docs/${data.document.id}`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Could not create the document");
      setCreating(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / perPage));

  const load = useCallback(async () => {
    const params = new URLSearchParams({
      page: String(page),
      perPage: String(perPage),
    });
    if (query) params.set("q", query);
    if (kind) params.set("kind", kind);
    if (sourceId) params.set("sourceId", sourceId);
    if (status) params.set("status", status);
    if (verified) params.set("verified", verified);
    if (drift) params.set("drift", "1");
    if (updatedWithin) params.set("updatedWithin", updatedWithin);
    if (Number(minChunks) > 0) params.set("minChunks", minChunks);
    const data = await fetch(`/api/documents?${params}`).then((r) => r.json());
    setDocs(data.documents ?? []);
    setTotal(data.total ?? 0);
    setKinds(data.kinds ?? []);
    setSources(data.sources ?? []);
    setLoaded(true);
  }, [page, perPage, query, kind, sourceId, status, verified, drift, updatedWithin, minChunks]);

  useEffect(() => {
    load();
  }, [load]);

  // debounce the filter box → query
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      setQuery(filter.trim());
      setPage(1);
    }, 300);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [filter]);

  // clamp page if the last page shrank away
  useEffect(() => {
    if (loaded && page > totalPages) setPage(totalPages);
  }, [loaded, page, totalPages]);

  const resetPage = () => setPage(1);

  const activeFilterCount = [
    kind,
    sourceId,
    status,
    verified,
    drift ? "1" : "",
    updatedWithin,
    Number(minChunks) > 0 ? minChunks : "",
  ].filter(Boolean).length;

  function clearFilters() {
    setKind("");
    setSourceId("");
    setStatus("");
    setVerified("");
    setDrift(false);
    setUpdatedWithin("");
    setMinChunks("");
    resetPage();
  }

  const pageIds = docs.map((d) => d.id);
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  function toggleAllOnPage() {
    const next = new Set(selected);
    if (allOnPageSelected) pageIds.forEach((id) => next.delete(id));
    else pageIds.forEach((id) => next.add(id));
    setSelected(next);
  }

  function toggleOne(e: React.MouseEvent | React.ChangeEvent, id: string) {
    e.stopPropagation();
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  function requestDeleteOne(e: React.MouseEvent, doc: Doc) {
    e.preventDefault();
    e.stopPropagation();
    setDeleteError(null);
    setPendingDelete({
      type: "single",
      id: doc.id,
      title: doc.title,
      permanent: doc.status === "archived",
    });
  }

  function requestDeleteSelected(permanent: boolean) {
    if (selected.size === 0) return;
    setDeleteError(null);
    setPendingDelete({ type: "bulk", count: selected.size, permanent });
  }

  async function restoreOne(e: React.MouseEvent, doc: Doc) {
    e.preventDefault();
    e.stopPropagation();
    setRestoringIds((s) => new Set(s).add(doc.id));
    setNotice(null);
    try {
      const res = await fetch(`/api/documents/${doc.id}/restore`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Restore failed");
      setNotice(`Restored "${doc.title}" — re-indexed into ${data.chunks} chunks.`);
      await load();
      refresh();
    } catch (err) {
      setNotice(`Restore failed: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally {
      setRestoringIds((s) => {
        const next = new Set(s);
        next.delete(doc.id);
        return next;
      });
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    setNotice(null);
    setDeleteError(null);
    const permanent = pendingDelete.permanent;
    try {
      if (pendingDelete.type === "single") {
        const res = await fetch(
          `/api/documents/${pendingDelete.id}${permanent ? "?permanent=1" : ""}`,
          { method: "DELETE" }
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? "Delete failed");
        }
        setSelected((s) => {
          const next = new Set(s);
          next.delete(pendingDelete.id);
          return next;
        });
        setNotice(
          permanent
            ? `Permanently deleted "${pendingDelete.title}".`
            : `Archived "${pendingDelete.title}" — removed from the index, restorable any time.`
        );
      } else {
        const ids = [...selected];
        const res = await fetch("/api/documents/bulk-delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids, permanent }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Bulk delete failed");
        setNotice(
          `${data.deleted} ${permanent ? "permanently deleted" : "archived"}${
            data.errors?.length ? ` · ${data.errors.length} failed` : ""
          }`
        );
        setSelected(new Set());
      }
      setPendingDelete(null);
      await load();
      refresh();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }

  const from = total === 0 ? 0 : (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);

  return (
    <>
      <TopStrip crumb="Nonaki / Documents" />
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin p-7">
        <div className="flex items-baseline gap-2.5">
          <h1 className="text-[21px] font-semibold tracking-[-0.01em]">Documents</h1>
          <span className="text-xs text-muted">
            {total} document{total === 1 ? "" : "s"}
            {query ? ` matching “${query}”` : ""}
          </span>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by title or source…"
            className="ml-auto w-60 rounded-[7px] border border-line bg-card px-3 py-1.5 text-xs outline-none focus:border-teal"
          />
          <button
            onClick={() => {
              setCreateError(null);
              setComposeOpen(true);
            }}
            className="flex-none rounded-[7px] bg-teal px-3.5 py-[7px] text-xs font-semibold text-white hover:bg-teal-dark"
          >
            <span className="flex items-center gap-1.5"><Icon name="plus" size={13} /> New document</span>
          </button>
        </div>

        {/* filters — compact dropdown toolbar */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <FilterSelect
            options={[
              { value: "", label: "All types", count: kinds.reduce((s, k) => s + k.count, 0) },
              ...kinds.map((k) => ({ value: k.kind, label: kindLabel(k.kind), count: k.count })),
            ]}
            value={kind}
            onChange={(v) => {
              setKind(v);
              resetPage();
            }}
            width="w-44"
          />
          {sources.length > 0 && (
            <SourceSelect
              sources={sources}
              value={sourceId}
              onChange={(id) => {
                setSourceId(id);
                resetPage();
              }}
            />
          )}
          <FilterSelect
            options={[
              { value: "", label: "Any status" },
              { value: "indexed", label: "Indexed" },
              { value: "archived", label: "Archived" },
            ]}
            value={status}
            onChange={(v) => {
              setStatus(v);
              resetPage();
            }}
            width="w-36"
          />
          <FilterSelect
            options={[
              { value: "", label: "Any time" },
              { value: "24h", label: "Updated in 24 h" },
              { value: "7d", label: "Updated in 7 days" },
              { value: "30d", label: "Updated in 30 days" },
            ]}
            value={updatedWithin}
            onChange={(v) => {
              setUpdatedWithin(v);
              resetPage();
            }}
            width="w-44"
          />
          <MoreFilters
            drift={drift}
            onDrift={(v) => {
              setDrift(v);
              resetPage();
            }}
            unverified={verified === "0"}
            onUnverified={(v) => {
              setVerified(v ? "0" : "");
              resetPage();
            }}
            minChunks={minChunks}
            onMinChunks={(v) => {
              setMinChunks(v);
              resetPage();
            }}
          />
          {activeFilterCount > 0 && (
            <button
              onClick={clearFilters}
              className="ml-1 flex items-center gap-1 text-[11px] font-semibold text-teal hover:text-teal-dark"
            >
              <Icon name="x" size={11} />
              Clear filters
            </button>
          )}
        </div>

        {notice && (
          <div className="mt-3 rounded-lg border border-green-soft bg-green-soft px-3.5 py-2.5 text-xs text-green-deep">
            {notice}
          </div>
        )}

        {/* bulk action bar */}
        {selected.size > 0 && (
          <div className="mt-3 flex items-center gap-3 rounded-lg border border-teal-line bg-teal-mist px-3.5 py-2">
            <span className="text-xs font-semibold text-teal-dark">
              {selected.size} selected
            </span>
            <button
              onClick={() => setSelected(new Set())}
              className="text-[11px] text-muted hover:text-ink"
            >
              Clear selection
            </button>
            <span className="ml-auto flex items-center gap-2">
              <button
                onClick={() => requestDeleteSelected(false)}
                disabled={deleting}
                className="rounded-md border border-edge bg-card px-3 py-1.5 text-[11.5px] font-semibold text-slate hover:border-teal hover:text-teal disabled:opacity-60"
              >
                <Icon name="archive" size={12} /> Archive {selected.size}
              </button>
              <button
                onClick={() => requestDeleteSelected(true)}
                disabled={deleting}
                className="rounded-md bg-[#c26b5a] px-3 py-1.5 text-[11.5px] font-semibold text-white hover:bg-[#a85647] disabled:opacity-60"
              >
                Delete {selected.size} permanently
              </button>
            </span>
          </div>
        )}

        <div className="mt-4 overflow-hidden rounded-xl border border-line bg-card">
          {/* header row */}
          <div className="flex items-center gap-3.5 border-b border-hairline bg-panel px-[18px] py-2">
            <input
              type="checkbox"
              checked={allOnPageSelected}
              onChange={toggleAllOnPage}
              title="Select all on this page"
              className="h-3.5 w-3.5 flex-none accent-[#0e7f93]"
            />
            <span className="font-mono text-[9.5px] tracking-[0.08em] text-muted">
              {allOnPageSelected ? "DESELECT PAGE" : "SELECT PAGE"}
            </span>
            <span className="ml-auto font-mono text-[9.5px] text-faint">
              {from}–{to} OF {total}
            </span>
          </div>

          {!loaded && <ListRowsSkeleton rows={8} />}

          {docs.map((d, i) => (
            <Link
              key={d.id}
              href={`/docs/${d.id}`}
              className={`flex items-center gap-3.5 px-[18px] py-3 transition-colors hover:bg-hover ${
                i < docs.length - 1 ? "border-b border-hairline-2" : ""
              } ${d.status === "archived" ? "opacity-60" : ""} ${
                selected.has(d.id) ? "bg-teal-wash" : ""
              }`}
            >
              <input
                type="checkbox"
                checked={selected.has(d.id)}
                onChange={(e) => toggleOne(e, d.id)}
                onClick={(e) => e.stopPropagation()}
                className="h-3.5 w-3.5 flex-none accent-[#0e7f93]"
              />
              <span className="w-12 flex-none rounded bg-chip px-1.5 py-0.5 text-center font-mono text-[9px] uppercase text-muted">
                {d.kind}
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[13px] font-semibold">{d.title}</span>
                  {d._count.proposals > 0 && (
                    <span className="flex-none rounded bg-amber-soft px-1.5 py-px font-mono text-[8.5px] text-amber">
                      DRIFT
                    </span>
                  )}
                  {!d.verified && d.status !== "archived" && (
                    <span className="flex-none rounded bg-chip px-1.5 py-px font-mono text-[8.5px] text-muted">
                      UNVERIFIED
                    </span>
                  )}
                  {d.status === "archived" && (
                    <span className="flex-none rounded bg-chip px-1.5 py-px font-mono text-[8.5px] text-muted">
                      ARCHIVED
                    </span>
                  )}
                </div>
                <div className="mt-px truncate text-[11.5px] text-muted">
                  {d.excerpt || "—"}
                </div>
              </div>
              <div className="ml-auto flex-none text-right font-mono text-[9.5px] leading-4 text-faint">
                <div>
                  v{d.version} · {d.chunkCount} CHUNKS
                </div>
                <div>
                  {d.source.name.toUpperCase()} · {timeAgo(d.updatedAt).toUpperCase()}
                </div>
              </div>
              {d.status === "archived" && (
                <button
                  onClick={(e) => restoreOne(e, d)}
                  disabled={restoringIds.has(d.id)}
                  title="Restore to the index"
                  className="flex-none rounded-md border border-teal-line bg-card px-2 py-1 text-[10.5px] font-semibold text-teal hover:bg-teal-soft disabled:opacity-50"
                >
                  {restoringIds.has(d.id) ? "…" : <span className="flex items-center gap-1"><Icon name="restore" size={11} /> Restore</span>}
                </button>
              )}
              <button
                onClick={(e) => requestDeleteOne(e, d)}
                title={
                  d.status === "archived"
                    ? "Delete permanently"
                    : "Archive document (removes it from Weaviate, restorable)"
                }
                className="flex-none rounded-md px-2 py-1 text-[13px] text-ghost transition-colors hover:bg-diff-del hover:text-diff-del-line"
              >
                <Icon name={d.status === "archived" ? "trash" : "archive"} size={13} />
              </button>
            </Link>
          ))}

          {loaded && docs.length === 0 && (
            <div className="px-[18px] py-8 text-center text-xs text-muted">
              {total === 0 && !query && activeFilterCount === 0 ? (
                <>
                  Nothing indexed yet —{" "}
                  <Link href="/sources" className="font-semibold text-teal">
                    connect a source
                  </Link>{" "}
                  to get started.
                </>
              ) : (
                "No documents match your filters."
              )}
            </div>
          )}
        </div>

        {/* pagination */}
        {total > 0 && (
          <div className="mt-3 flex items-center gap-2">
            <span className="text-[11px] text-muted">Per page</span>
            {PER_PAGE_OPTIONS.map((n) => (
              <button
                key={n}
                onClick={() => {
                  setPerPage(n);
                  setPage(1);
                }}
                className={`rounded-md border px-2 py-1 text-[11px] ${
                  perPage === n
                    ? "border-teal bg-teal-soft font-semibold text-teal-dark"
                    : "border-edge text-muted hover:border-teal"
                }`}
              >
                {n}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-1.5">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded-md border border-edge px-2.5 py-1 text-[11.5px] text-slate hover:border-teal hover:text-teal disabled:opacity-40"
              >
                ← Prev
              </button>
              <Pager page={page} totalPages={totalPages} onPage={setPage} />
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="rounded-md border border-edge px-2.5 py-1 text-[11.5px] text-slate hover:border-teal hover:text-teal disabled:opacity-40"
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </div>
      {composeOpen && (
        <div
          role="presentation"
          className="fixed inset-0 z-[80] grid place-items-center bg-black/35 px-4 py-8 backdrop-blur-[2px]"
          onMouseDown={() => {
            if (!creating) setComposeOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="flex max-h-full w-[620px] max-w-full flex-col overflow-hidden rounded-lg border border-line bg-card shadow-[0_18px_60px_rgba(10,20,25,0.28)]"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex flex-none items-center gap-2.5 border-b border-hairline px-5 py-3.5">
              <span className="text-teal"><Icon name="edit" size={14} /></span>
              <div>
                <div className="text-[14px] font-semibold">New document</div>
                <div className="text-[11px] text-muted">
                  Written by hand — chunked & indexed in Weaviate the moment you save
                </div>
              </div>
              <button
                onClick={() => setComposeOpen(false)}
                disabled={creating}
                className="ml-auto rounded-md px-2 py-1 text-[13px] text-muted hover:text-ink"
              >
                <Icon name="x" size={14} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin px-5 py-4">
              <label className="block">
                <span className="text-xs font-semibold">Title</span>
                <input
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  autoFocus
                  placeholder="e.g. Refund policy — internal notes"
                  className="mt-1 w-full rounded-[7px] border border-line bg-card px-3 py-2 text-[13px] outline-none focus:border-teal"
                />
              </label>
              <div className="mt-3">
                <span className="text-xs font-semibold">Content</span>
                <NotionEditor
                  value={newContent}
                  onChange={setNewContent}
                  title={newTitle}
                  placeholder="Write or paste the knowledge you want the assistant to answer from… Type '/' for blocks."
                  wrapperClassName="mt-1 rounded-lg border border-line bg-card px-3.5 py-3 focus-within:border-teal"
                  contentClassName="min-h-[240px]"
                />
              </div>
              {createError && (
                <div className="mt-3 rounded-lg border border-warn-line bg-warn-bg px-3 py-2 text-xs text-warn-text">
                  {createError}
                </div>
              )}
            </div>
            <div className="flex flex-none items-center gap-2.5 border-t border-hairline bg-panel px-5 py-3">
              <span className="text-[10.5px] text-faint">
                Lands under the “Manual entries” source · searchable immediately
              </span>
              <button
                onClick={() => setComposeOpen(false)}
                disabled={creating}
                className="ml-auto rounded-md border border-edge bg-card px-3 py-1.5 text-[12px] font-semibold text-slate hover:border-teal hover:text-teal disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={createDoc}
                disabled={creating || !newTitle.trim() || !newContent.trim()}
                className="rounded-md bg-teal px-3.5 py-1.5 text-[12px] font-semibold text-white hover:bg-teal-dark disabled:opacity-60"
              >
                {creating ? "Indexing…" : "Create & index"}
              </button>
            </div>
          </div>
        </div>
      )}
      <DeleteConfirmDialog
        open={pendingDelete !== null}
        title={
          pendingDelete?.type === "bulk"
            ? `${pendingDelete.permanent ? "Permanently delete" : "Archive"} ${pendingDelete.count} document${pendingDelete.count === 1 ? "" : "s"}?`
            : `${pendingDelete?.permanent ? "Permanently delete" : "Archive"} "${pendingDelete?.title ?? ""}"?`
        }
        description={
          pendingDelete?.permanent
            ? "This removes the content, version history and indexed chunks for good."
            : "This removes the selection from search, but keeps it restorable."
        }
        confirmLabel={
          pendingDelete?.type === "bulk"
            ? `${pendingDelete.permanent ? "Delete" : "Archive"} ${pendingDelete.count} document${pendingDelete.count === 1 ? "" : "s"}`
            : pendingDelete?.permanent
              ? "Delete permanently"
              : "Archive document"
        }
        warning={
          pendingDelete?.permanent
            ? "This cannot be undone — content, version history and Weaviate chunks are permanently removed."
            : "Archived documents stop appearing in answers and search immediately. Restore them any time with the Restore button."
        }
        tone={pendingDelete?.permanent ? "danger" : "archive"}
        requireText={pendingDelete?.permanent ? "DELETE" : undefined}
        loading={deleting}
        error={deleteError}
        onCancel={() => {
          if (deleting) return;
          setPendingDelete(null);
          setDeleteError(null);
        }}
        onConfirm={confirmDelete}
      />
    </>
  );
}

/** Compact page-number strip: 1 … 4 [5] 6 … 12 */
function Pager({
  page,
  totalPages,
  onPage,
}: {
  page: number;
  totalPages: number;
  onPage: (p: number) => void;
}) {
  const pages: (number | "…")[] = [];
  const push = (p: number | "…") => {
    if (pages[pages.length - 1] !== p) pages.push(p);
  };
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || Math.abs(p - page) <= 1) push(p);
    else push("…");
  }
  return (
    <>
      {pages.map((p, i) =>
        p === "…" ? (
          <span key={`e${i}`} className="px-1 text-[11px] text-faint">
            …
          </span>
        ) : (
          <button
            key={p}
            onClick={() => onPage(p)}
            className={`min-w-[26px] rounded-md border px-1.5 py-1 text-[11.5px] ${
              p === page
                ? "border-teal bg-teal text-white"
                : "border-edge text-slate hover:border-teal hover:text-teal"
            }`}
          >
            {p}
          </button>
        )
      )}
    </>
  );
}

/** "More" popover for the rarely-used filters: pending review, unverified, min chunks. */
function MoreFilters({
  drift,
  onDrift,
  unverified,
  onUnverified,
  minChunks,
  onMinChunks,
}: {
  drift: boolean;
  onDrift: (v: boolean) => void;
  unverified: boolean;
  onUnverified: (v: boolean) => void;
  minChunks: string;
  onMinChunks: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const activeCount = (drift ? 1 : 0) + (unverified ? 1 : 0) + (Number(minChunks) > 0 ? 1 : 0);

  const toggleRow = (label: string, hint: string, active: boolean, onToggle: () => void) => (
    <button
      onClick={onToggle}
      className="flex w-full items-center gap-2.5 border-b border-row-line px-3 py-2 text-left text-xs hover:bg-hover"
    >
      <span
        className={`grid h-3.5 w-3.5 flex-none place-items-center rounded border ${
          active ? "border-teal bg-teal text-white" : "border-ghost bg-card"
        }`}
      >
        {active && <Icon name="check" size={9} />}
      </span>
      <span className="min-w-0">
        <span className={`block ${active ? "font-semibold text-teal-dark" : ""}`}>{label}</span>
        <span className="block text-[10px] text-faint">{hint}</span>
      </span>
    </button>
  );

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
          activeCount > 0
            ? "border-teal bg-teal-soft font-semibold text-teal-dark"
            : "border-edge bg-card text-muted hover:border-teal hover:text-teal"
        }`}
      >
        More
        {activeCount > 0 && (
          <span className="rounded-full bg-teal px-1.5 font-mono text-[8.5px] font-bold text-white">
            {activeCount}
          </span>
        )}
        <span className="text-[8px]">▾</span>
      </button>

      {open && (
        <div className="absolute left-0 top-[calc(100%+6px)] z-30 w-60 overflow-hidden rounded-lg border border-line bg-card shadow-[0_8px_28px_rgba(10,20,25,0.14)]">
          {toggleRow("Pending review", "Has a proposal waiting in the queue", drift, () =>
            onDrift(!drift)
          )}
          {toggleRow("Unverified", "Not yet marked as verified", unverified, () =>
            onUnverified(!unverified)
          )}
          <div className="flex items-center gap-2.5 px-3 py-2 text-xs">
            <span className="min-w-0">
              <span className="block">Min chunks</span>
              <span className="block text-[10px] text-faint">Hide thin documents</span>
            </span>
            <input
              type="number"
              min={0}
              value={minChunks}
              onChange={(e) => onMinChunks(e.target.value)}
              placeholder="0"
              className="ml-auto w-14 rounded-md border border-edge bg-card px-2 py-1 text-[11px] outline-none focus:border-teal"
            />
          </div>
        </div>
      )}
    </div>
  );
}
