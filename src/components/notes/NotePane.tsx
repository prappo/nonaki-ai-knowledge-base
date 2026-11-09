"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { NotionEditor } from "@/components/NotionEditor";
import { Icon } from "@/components/Icons";
import { FilterSelect } from "@/components/FilterSelect";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { VersionHistoryDialog } from "@/components/VersionHistoryDialog";
import { Skeleton, TextSkeleton } from "@/components/Skeleton";
import { checklist, wikiLinks, wordCount } from "@/lib/noteText";

export type NoteDetail = {
  id: string;
  owner: string;
  title: string;
  content: string;
  folderId: string | null;
  projectId: string | null;
  tags: string[];
  pinned: boolean;
  shared: boolean;
  version: number;
  updatedBy: string | null;
  documentId: string | null;
  publishedAt: string | null;
  publishStale: boolean;
  archivedAt: string | null;
  trashedAt: string | null;
  createdAt: string;
  updatedAt: string;
  mine: boolean;
  project: { id: string; name: string } | null;
};

type Detail = {
  note: NoteDetail;
  links: { title: string; id: string | null }[];
  backlinks: { id: string; title: string; updatedAt: string }[];
  versionCount: number;
};

type SaveState = "saved" | "dirty" | "saving" | "error" | "conflict";
type SuggestedTask = { title: string; priority: "low" | "medium" | "high"; dueDate: string | null; pick: boolean };

const AUTOSAVE_MS = 800;

export function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
  if (s < 7 * 86_400) return `${Math.round(s / 86_400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

const who = (email: string | null) => (email ? email.split("@")[0] : "someone");

/**
 * One note, open for editing: autosaves as you type (and on ⌘S), files it
 * into a folder or project, tags, pins, shares, versions, exports, puts it
 * in the knowledge base, and asks the AI for a summary or its action items.
 */
export function NotePane({
  id,
  folders,
  projects,
  onSaved,
  onMetaChanged,
  onOpen,
  onCreateLinked,
  onGone,
}: {
  id: string;
  folders: { id: string; name: string }[];
  projects: { id: string; name: string }[];
  /** The text was saved; the list can update its row in place. */
  onSaved: (note: NoteDetail) => void;
  /** Something that can move the note between views changed (pin, folder, trash…). */
  onMetaChanged: () => void;
  onOpen: (id: string) => void;
  onCreateLinked: (title: string) => void;
  /** The note was deleted, or isn't there any more. */
  onGone: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [missing, setMissing] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [save, setSave] = useState<SaveState>("saved");
  const [conflict, setConflict] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [tasks, setTasks] = useState<SuggestedTask[] | null>(null);
  const [editorKey, setEditorKey] = useState(0);

  // What the server last confirmed, and what is being typed: the save loop
  // reads these refs so a slow request never saves stale text.
  const saved = useRef({ title: "", content: "", updatedAt: "" });
  const draft = useRef({ title: "", content: "" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef(false);
  const again = useRef(false);

  const dirty = () => draft.current.title !== saved.current.title || draft.current.content !== saved.current.content;

  const adopt = useCallback((d: Detail) => {
    setDetail(d);
    setTitle(d.note.title);
    setContent(d.note.content);
    saved.current = { title: d.note.title, content: d.note.content, updatedAt: d.note.updatedAt };
    draft.current = { title: d.note.title, content: d.note.content };
    setSave("saved");
    setConflict(null);
  }, []);

  /** Fetch the note. Pure: callers decide what to do with a missing one or an error. */
  const fetchNote = useCallback(async (): Promise<{ detail: Detail } | { missing: true } | { error: string }> => {
    const res = await fetch(`/api/notes/${id}`);
    if (res.status === 404) return { missing: true };
    const data = (await res.json().catch(() => ({}))) as Detail & { error?: string };
    return res.ok ? { detail: data } : { error: data.error ?? "Could not open the note" };
  }, [id]);

  const load = useCallback(async () => {
    const result = await fetchNote();
    if ("missing" in result) setMissing(true);
    else if ("error" in result) setError(result.error);
    else return result.detail;
    return null;
  }, [fetchNote]);

  // The page keys this pane by note id, so a new note starts from fresh state.
  useEffect(() => {
    let live = true;
    fetchNote().then((result) => {
      if (!live) return;
      if ("detail" in result) adopt(result.detail);
      else if ("missing" in result) setMissing(true);
      else setError(result.error);
    });
    return () => {
      live = false;
    };
  }, [fetchNote, adopt]);

  /** Refresh links, backlinks and history counts without touching the text being edited. */
  const refreshSide = useCallback(async () => {
    const d = await load();
    if (d) setDetail((cur) => (cur ? { ...d, note: { ...d.note, title: cur.note.title, content: cur.note.content } } : d));
  }, [load]);

  const flush = useCallback(
    async (overwrite = false) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      if (!dirty()) {
        setSave((s) => (s === "conflict" ? s : "saved"));
        return;
      }
      if (inflight.current) {
        again.current = true;
        return;
      }
      inflight.current = true;
      const sent = { ...draft.current };
      setSave("saving");
      try {
        const res = await fetch(`/api/notes/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...sent, ...(overwrite ? {} : { expectedUpdatedAt: saved.current.updatedAt }) }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 409 && !overwrite) {
          setConflict(data.error ?? "This note changed somewhere else.");
          setSave("conflict");
          return;
        }
        if (!res.ok) throw new Error(data.error ?? "Save failed");
        const note = data.note as NoteDetail;
        const linksChanged = wikiLinks(saved.current.content).join("\n") !== wikiLinks(sent.content).join("\n");
        const renamed = saved.current.title !== sent.title;
        saved.current = { title: sent.title, content: sent.content, updatedAt: note.updatedAt };
        if (linksChanged || renamed) void refreshSide();
        setConflict(null);
        setDetail((cur) => (cur ? { ...cur, note: { ...cur.note, ...note, title: sent.title, content: sent.content } } : cur));
        onSaved({ ...note, title: sent.title, content: sent.content } as NoteDetail);
        setSave(dirty() ? "dirty" : "saved");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Save failed");
        setSave("error");
      } finally {
        inflight.current = false;
        if (again.current) {
          again.current = false;
          void flush();
        }
      }
    },
    [id, onSaved, refreshSide]
  );

  function edit(next: { title?: string; content?: string }) {
    draft.current = { ...draft.current, ...next };
    if (next.title !== undefined) setTitle(next.title);
    if (next.content !== undefined) setContent(next.content);
    if (save === "conflict") return;
    setSave("dirty");
    setError(null);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), AUTOSAVE_MS);
  }

  // Save what's left when switching notes or leaving the page.
  useEffect(() => {
    const noteId = id;
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty()) e.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      if (timer.current) clearTimeout(timer.current);
      if (dirty() && saved.current.updatedAt) {
        void fetch(`/api/notes/${noteId}`, {
          method: "PATCH",
          keepalive: true,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...draft.current, expectedUpdatedAt: saved.current.updatedAt }),
        });
      }
    };
  }, [id]);

  // ⌘S / Ctrl+S saves now.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void flush();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flush]);

  async function patchMeta(body: Record<string, unknown>, done?: string) {
    setError(null);
    const res = await fetch(`/api/notes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Could not update the note");
      return false;
    }
    setDetail((cur) => (cur ? { ...cur, note: { ...cur.note, ...data.note, title: cur.note.title, content: cur.note.content } } : cur));
    if (body.projectId !== undefined) void refreshSide();
    if (done) setFlash(done);
    onMetaChanged();
    return true;
  }

  async function resolveConflict(choice: "theirs" | "mine") {
    if (choice === "mine") {
      setSave("dirty");
      await flush(true);
      return;
    }
    const d = await load();
    if (d) {
      adopt(d);
      setEditorKey((k) => k + 1);
    }
  }

  async function publish(remove = false) {
    await flush();
    setBusy(remove ? "unpublish" : "publish");
    setError(null);
    try {
      const res = await fetch(`/api/notes/${id}/publish`, { method: remove ? "DELETE" : "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setFlash(remove ? "Removed from the knowledge base." : `In the knowledge base: ${data.chunks} chunk${data.chunks === 1 ? "" : "s"} indexed. Ask can now answer from it.`);
      await refreshSide();
      onMetaChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  async function ai(action: "summarize" | "tasks") {
    await flush();
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/notes/${id}/ai`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "The AI request failed");
      if (action === "summarize") setSummary(data.summary as string);
      else setTasks((data.tasks as Omit<SuggestedTask, "pick">[]).map((t) => ({ ...t, pick: true })));
    } catch (err) {
      setError(err instanceof Error ? err.message : "The AI request failed");
    } finally {
      setBusy(null);
    }
  }

  async function createTasks() {
    const picked = (tasks ?? []).filter((t) => t.pick);
    if (!picked.length) return;
    setBusy("create-tasks");
    setError(null);
    try {
      const res = await fetch(`/api/notes/${id}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tasks: picked.map(({ title, priority, dueDate }) => ({ title, priority, dueDate })) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not create the tasks");
      setTasks(null);
      setFlash(`Created ${picked.length} task${picked.length === 1 ? "" : "s"}${detail?.note.project ? ` on ${detail.note.project.name}` : ""}, assigned to you.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the tasks");
    } finally {
      setBusy(null);
    }
  }

  function insertSummary() {
    if (!summary) return;
    edit({ content: `## Summary\n\n${summary}\n\n${draft.current.content}` });
    setEditorKey((k) => k + 1);
    setSummary(null);
  }

  function exportMarkdown() {
    const name = (draft.current.title.trim() || "note").replace(/[^\p{L}\p{N} _-]+/gu, "").trim().slice(0, 80) || "note";
    const tags = detail?.note.tags.length ? `\n\nTags: ${detail.note.tags.map((t) => `#${t}`).join(" ")}` : "";
    const body = `# ${draft.current.title.trim() || "Untitled note"}\n\n${draft.current.content}${tags}\n`;
    const url = URL.createObjectURL(new Blob([body], { type: "text/markdown;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${location.origin}/notes?id=${id}`);
      setFlash(detail?.note.shared || !detail?.note.mine ? "Link copied." : "Link copied. Share the note so others can open it.");
    } catch {
      setError("Could not copy the link.");
    }
  }

  async function deleteForever() {
    setBusy("delete");
    const res = await fetch(`/api/notes/${id}`, { method: "DELETE" });
    setBusy(null);
    setConfirmDelete(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Delete failed");
      return;
    }
    onGone();
  }

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 5000);
    return () => clearTimeout(t);
  }, [flash]);

  if (missing) {
    return (
      <div className="grid flex-1 place-items-center p-10 text-center text-xs text-muted">
        <div>
          <p>This note doesn&apos;t exist, or it isn&apos;t shared with you.</p>
          <button onClick={onGone} className="mt-2 text-teal hover:underline">
            Back to your notes
          </button>
        </div>
      </div>
    );
  }

  if (!detail && error) {
    return <div className="grid flex-1 place-items-center p-10 text-center text-xs text-orange">{error}</div>;
  }

  if (!detail) {
    return (
      <div className="flex-1 p-10">
        <Skeleton className="h-7 w-2/3" />
        <div className="mt-6">
          <TextSkeleton lines={6} />
        </div>
      </div>
    );
  }

  const { note, links, backlinks } = detail;
  const trashed = Boolean(note.trashedAt);
  const words = wordCount(content);
  const progress = checklist(content);
  const projectOptions = [{ value: "", label: "No project" }, ...projects.map((p) => ({ value: p.id, label: p.name }))];
  const folderOptions = [{ value: "", label: "No folder" }, ...folders.map((f) => ({ value: f.id, label: f.name }))];

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {/* toolbar */}
      <div className="flex flex-none flex-wrap items-center gap-2 border-b border-hairline px-6 py-2">
        {note.mine && !trashed && (
          <FilterSelect options={folderOptions} value={note.folderId ?? ""} onChange={(v) => void patchMeta({ folderId: v || null })} width="w-48" />
        )}
        {!trashed && <FilterSelect options={projectOptions} value={note.projectId ?? ""} onChange={(v) => void patchMeta({ projectId: v || null })} width="w-56" />}
        <SaveBadge state={save} />
        <div className="ml-auto flex items-center gap-1">
          {!trashed && (
            <>
              <ToolButton icon="pin" label={note.pinned ? "Unpin" : "Pin to the top"} active={note.pinned} onClick={() => void patchMeta({ pinned: !note.pinned })} />
              {note.mine && (
                <ToolButton
                  icon="users"
                  label={note.shared ? "Shared with the team: click to make it private" : "Private: click to share with the team"}
                  active={note.shared}
                  onClick={() =>
                    void patchMeta({ shared: !note.shared }, note.shared ? "Private again: only you can see it." : "Shared: everyone signed in can now read and edit this note.")
                  }
                />
              )}
              <ToolButton icon="history" label={`Version history (${detail.versionCount})`} onClick={() => void flush().then(() => setHistoryOpen(true))} />
            </>
          )}
          <div className="relative">
            <ToolButton icon="more" label="More" onClick={() => setMenuOpen((v) => !v)} />
            {menuOpen && (
              <>
                <button className="fixed inset-0 z-20 cursor-default" aria-label="Close menu" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-[calc(100%+6px)] z-30 w-60 overflow-hidden rounded-lg border border-line bg-card py-1 shadow-[0_8px_28px_rgba(10,20,25,0.14)]">
                  {trashed ? (
                    <>
                      <MenuItem icon="restore" label="Restore from trash" onClick={() => void patchMeta({ trashed: false }, "Restored.")} />
                      <MenuItem icon="trash" label="Delete forever…" danger onClick={() => setConfirmDelete(true)} />
                    </>
                  ) : (
                    <>
                      <MenuItem icon="download" label="Export as Markdown" onClick={exportMarkdown} />
                      <MenuItem icon="link" label="Copy link" onClick={() => void copyLink()} />
                      {note.mine && (
                        <>
                          <div className="my-1 border-t border-hairline" />
                          {note.documentId ? (
                            <>
                              <MenuItem icon="book" label={note.publishStale ? "Update the knowledge base copy" : "Refresh the knowledge base copy"} onClick={() => void publish()} />
                              <MenuItem icon="x" label="Remove from the knowledge base" onClick={() => void publish(true)} />
                            </>
                          ) : (
                            <MenuItem icon="book" label="Add to the knowledge base" onClick={() => void publish()} />
                          )}
                          <div className="my-1 border-t border-hairline" />
                          <MenuItem
                            icon="archive"
                            label={note.archivedAt ? "Unarchive" : "Archive"}
                            onClick={() => void patchMeta({ archived: !note.archivedAt }, note.archivedAt ? "Back in your notes." : "Archived.")}
                          />
                          <MenuItem icon="trash" label="Move to trash" danger onClick={() => void flush().then(() => patchMeta({ trashed: true }, "Moved to the trash."))} />
                        </>
                      )}
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <div className="mx-auto max-w-[760px] px-8 pb-16 pt-7">
          {/* status banners */}
          {trashed && (
            <Banner tone="warn">
              In the trash since {timeAgo(note.trashedAt!)}. It&apos;s deleted for good after 30 days. Restore it to edit.
            </Banner>
          )}
          {note.archivedAt && !trashed && <Banner tone="neutral">Archived. It&apos;s hidden from your notes and still searchable here.</Banner>}
          {!note.mine && (
            <Banner tone="neutral">
              Shared by {who(note.owner)}. You can edit the text; only they can move, share or delete it.
            </Banner>
          )}
          {conflict && (
            <Banner tone="warn">
              {conflict} Your latest typing isn&apos;t saved.
              <span className="ml-2 inline-flex gap-2">
                <button onClick={() => void resolveConflict("theirs")} className="font-semibold text-teal hover:underline">
                  Load their version
                </button>
                <button onClick={() => void resolveConflict("mine")} className="font-semibold text-orange hover:underline">
                  Keep mine
                </button>
              </span>
            </Banner>
          )}
          {error && <Banner tone="warn">{error}</Banner>}
          {flash && <Banner tone="ok">{flash}</Banner>}

          <input
            value={title}
            onChange={(e) => edit({ title: e.target.value })}
            readOnly={trashed}
            placeholder="Untitled note"
            maxLength={300}
            className="w-full bg-transparent text-[26px] font-bold tracking-[-0.02em] text-ink outline-none placeholder:text-ghost"
          />

          <TagEditor tags={note.tags} readOnly={trashed} onChange={(tags) => void patchMeta({ tags })} />

          {/* AI + knowledge base strip */}
          {!trashed && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
              <AiButton busy={busy === "summarize"} onClick={() => void ai("summarize")}>
                ✦ Summarize
              </AiButton>
              <AiButton busy={busy === "tasks"} onClick={() => void ai("tasks")}>
                ✦ Find action items
              </AiButton>
              {note.documentId && (
                <Link href={`/docs/${note.documentId}`} className={`ml-1 rounded-full px-2 py-0.5 ${note.publishStale ? "bg-amber-soft text-amber" : "bg-green-soft text-green-deep"}`}>
                  {note.publishStale ? "Knowledge base copy is out of date" : "In the knowledge base"}
                </Link>
              )}
              {(busy === "publish" || busy === "unpublish") && <span className="text-muted">Updating the knowledge base…</span>}
            </div>
          )}

          {summary && (
            <div className="mt-3 rounded-lg border border-teal-hairline bg-teal-mist px-4 py-3">
              <div className="mb-1 font-mono text-[9.5px] tracking-[0.08em] text-teal-dark">AI SUMMARY</div>
              <NotionEditor value={summary} readOnly contentClassName="text-[12.5px]" />
              <div className="mt-2 flex gap-3 text-[11px]">
                <button onClick={insertSummary} className="font-semibold text-teal hover:underline">
                  Insert at the top
                </button>
                <button onClick={() => void navigator.clipboard.writeText(summary)} className="text-muted hover:text-ink">
                  Copy
                </button>
                <button onClick={() => setSummary(null)} className="ml-auto text-muted hover:text-ink">
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {tasks && (
            <div className="mt-3 rounded-lg border border-teal-hairline bg-teal-mist px-4 py-3">
              <div className="mb-2 font-mono text-[9.5px] tracking-[0.08em] text-teal-dark">ACTION ITEMS</div>
              {tasks.length === 0 ? (
                <p className="text-[12px] text-muted">No open action items in this note.</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {tasks.map((t, i) => (
                    <li key={i} className="flex items-center gap-2 text-[12.5px]">
                      <input
                        type="checkbox"
                        checked={t.pick}
                        onChange={() => setTasks((list) => list!.map((x, j) => (j === i ? { ...x, pick: !x.pick } : x)))}
                        className="accent-teal"
                      />
                      <span className="min-w-0 flex-1">{t.title}</span>
                      {t.dueDate && <span className="font-mono text-[10px] text-muted">{t.dueDate}</span>}
                      <span className={`rounded-full px-1.5 text-[9.5px] ${t.priority === "high" ? "bg-diff-del text-diff-del-line" : "bg-chip text-muted"}`}>{t.priority}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-2.5 flex items-center gap-3 text-[11px]">
                {tasks.some((t) => t.pick) && (
                  <button
                    onClick={() => void createTasks()}
                    disabled={busy === "create-tasks"}
                    className="rounded-md bg-teal px-2.5 py-1 font-semibold text-white hover:bg-teal-dark disabled:opacity-50"
                  >
                    {busy === "create-tasks" ? "Creating…" : `Create ${tasks.filter((t) => t.pick).length} task${tasks.filter((t) => t.pick).length === 1 ? "" : "s"}`}
                  </button>
                )}
                <span className="text-muted">{note.project ? `On ${note.project.name}, assigned to you` : "Assigned to you; pick a project above to file them there"}</span>
                <button onClick={() => setTasks(null)} className="ml-auto text-muted hover:text-ink">
                  Dismiss
                </button>
              </div>
            </div>
          )}

          <div className="mt-5">
            <NotionEditor
              key={`${id}-${editorKey}`}
              value={content}
              onChange={(md) => edit({ content: md })}
              title={title}
              readOnly={trashed}
              checklists
              placeholder="Write, or type '/' for headings, checklists and more. Link another note with [[Note title]]."
              contentClassName="min-h-[320px]"
            />
          </div>

          {/* links */}
          {(links.length > 0 || backlinks.length > 0) && (
            <div className="mt-10 grid gap-4 border-t border-hairline pt-5 sm:grid-cols-2">
              {links.length > 0 && (
                <LinkList title="Links in this note">
                  {links.map((l) =>
                    l.id ? (
                      <LinkRow key={l.title} onClick={() => onOpen(l.id!)}>
                        {l.title}
                      </LinkRow>
                    ) : (
                      <LinkRow key={l.title} muted onClick={() => onCreateLinked(l.title)}>
                        {l.title} <span className="text-[10px] text-teal">· create</span>
                      </LinkRow>
                    )
                  )}
                </LinkList>
              )}
              {backlinks.length > 0 && (
                <LinkList title="Linked from">
                  {backlinks.map((b) => (
                    <LinkRow key={b.id} onClick={() => onOpen(b.id)}>
                      {b.title || "Untitled note"}
                    </LinkRow>
                  ))}
                </LinkList>
              )}
            </div>
          )}
        </div>
      </div>

      {/* footer */}
      <div className="flex flex-none flex-wrap items-center gap-3 border-t border-hairline px-6 py-1.5 font-mono text-[10px] tracking-[0.03em] text-muted">
        <span>
          {words.toLocaleString()} WORD{words === 1 ? "" : "S"} · {Math.max(1, Math.round(words / 220))} MIN READ
        </span>
        {progress.total > 0 && (
          <span className={progress.done === progress.total ? "text-green" : ""}>
            ☑ {progress.done}/{progress.total} DONE
          </span>
        )}
        <span className="ml-auto">
          V{note.version} · EDITED {timeAgo(note.updatedAt).toUpperCase()}
          {note.updatedBy && note.updatedBy !== note.owner ? ` BY ${who(note.updatedBy).toUpperCase()}` : ""}
          {" · "}CREATED {new Date(note.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }).toUpperCase()}
        </span>
      </div>

      <VersionHistoryDialog
        documentId={id}
        basePath={`/api/notes/${id}/versions`}
        copy={{
          kept: "a version is kept every 10 minutes while you edit",
          empty: "No earlier versions yet. One is kept every 10 minutes while the note is being edited.",
          restore: "Restoring keeps the current text as a version too, so nothing is lost",
        }}
        currentTitle={title || "Untitled note"}
        currentVersion={note.version}
        currentContent={content}
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onRestored={() => {
          void load().then((d) => {
            if (d) {
              adopt(d);
              setEditorKey((k) => k + 1);
              onSaved(d.note);
            }
          });
          setFlash("Version restored.");
        }}
      />

      <DeleteConfirmDialog
        open={confirmDelete}
        title="Delete this note forever?"
        description={`"${note.title || "Untitled note"}" and its version history will be deleted. This can't be undone.`}
        warning={note.documentId ? "Its copy in the knowledge base is removed too." : undefined}
        confirmLabel="Delete forever"
        tone="danger"
        loading={busy === "delete"}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void deleteForever()}
      />
    </div>
  );
}

function SaveBadge({ state }: { state: SaveState }) {
  const text = { saved: "Saved", dirty: "Editing…", saving: "Saving…", error: "Not saved", conflict: "Conflict" }[state];
  const tone = state === "error" || state === "conflict" ? "text-orange" : state === "saved" ? "text-faint" : "text-muted";
  return <span className={`ml-1 font-mono text-[10px] tracking-[0.04em] ${tone}`}>{text.toUpperCase()}</span>;
}

function ToolButton({ icon, label, active, onClick }: { icon: string; label: string; active?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`grid h-7 w-7 place-items-center rounded-md transition-colors ${active ? "bg-teal-soft text-teal-dark" : "text-muted hover:bg-hover hover:text-ink"}`}
    >
      <Icon name={icon} size={14} />
    </button>
  );
}

function MenuItem({ icon, label, danger, onClick }: { icon: string; label: string; danger?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[12px] hover:bg-hover ${danger ? "text-orange" : "text-body"}`}>
      <Icon name={icon} size={13} className="flex-none text-muted" />
      {label}
    </button>
  );
}

function Banner({ tone, children }: { tone: "warn" | "neutral" | "ok"; children: React.ReactNode }) {
  const cls =
    tone === "warn"
      ? "border-warn-line bg-warn-bg text-warn-text"
      : tone === "ok"
        ? "border-teal-hairline bg-teal-mist text-teal-ink"
        : "border-line bg-panel text-slate";
  return <div className={`mb-3 rounded-lg border px-3 py-2 text-[11.5px] leading-relaxed ${cls}`}>{children}</div>;
}

function AiButton({ busy, onClick, children }: { busy: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} disabled={busy} className="rounded-full border border-edge bg-card px-2.5 py-0.5 text-slate hover:border-teal hover:text-teal disabled:opacity-60">
      {busy ? "Thinking…" : children}
    </button>
  );
}

function LinkList({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 font-mono text-[9.5px] tracking-[0.08em] text-muted">{title.toUpperCase()}</div>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

function LinkRow({ onClick, muted, children }: { onClick: () => void; muted?: boolean; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[12.5px] hover:bg-hover ${muted ? "text-muted" : "text-teal"}`}>
      <Icon name="link" size={11} className="flex-none text-faint" />
      <span className="truncate">{children}</span>
    </button>
  );
}

/** Tags as chips; Enter or comma adds, Backspace on an empty field removes the last. */
function TagEditor({ tags, readOnly, onChange }: { tags: string[]; readOnly: boolean; onChange: (tags: string[]) => void }) {
  const [text, setText] = useState("");
  const add = () => {
    const t = text.trim().replace(/^#+/, "").toLowerCase().replace(/\s+/g, "-");
    setText("");
    if (t && !tags.includes(t)) onChange([...tags, t]);
  };
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <Icon name="tag" size={12} className="flex-none text-faint" />
      {tags.map((t) => (
        <span key={t} className="flex items-center gap-1 rounded-full bg-chip px-2 py-0.5 text-[11px] text-slate">
          #{t}
          {!readOnly && (
            <button onClick={() => onChange(tags.filter((x) => x !== t))} className="text-faint hover:text-orange" aria-label={`Remove tag ${t}`}>
              ×
            </button>
          )}
        </span>
      ))}
      {!readOnly && (
        <input
          value={text}
          onChange={(e) => setText(e.target.value.replace(",", ""))}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add();
            } else if (e.key === "Backspace" && !text && tags.length) onChange(tags.slice(0, -1));
          }}
          onBlur={add}
          placeholder={tags.length ? "Add tag" : "Add tags"}
          className="w-24 bg-transparent text-[11px] outline-none placeholder:text-faint"
        />
      )}
    </div>
  );
}
