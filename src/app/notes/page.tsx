"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { TopStrip } from "@/components/Shell";
import { Icon } from "@/components/Icons";
import { FilterSelect } from "@/components/FilterSelect";
import { ListRowsSkeleton } from "@/components/Skeleton";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { NotePane, timeAgo, type NoteDetail } from "@/components/notes/NotePane";
import { NOTE_TEMPLATES, fillTemplate, type NoteTemplate } from "@/lib/noteTemplates";
import { checklist, excerpt } from "@/lib/noteText";

type View = "all" | "pinned" | "shared" | "archive" | "trash";
type Sort = "updated" | "created" | "title";

type NoteRow = {
  id: string;
  owner: string;
  title: string;
  excerpt: string;
  folderId: string | null;
  projectId: string | null;
  tags: string[];
  pinned: boolean;
  shared: boolean;
  documentId: string | null;
  publishStale: boolean;
  archivedAt: string | null;
  trashedAt: string | null;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
  checklist: { done: number; total: number };
  mine: boolean;
};

type Notebook = {
  notes: NoteRow[];
  truncated: boolean;
  folders: { id: string; name: string; count: number }[];
  tags: { name: string; count: number }[];
  counts: Record<View, number>;
  me: string;
};

const VIEWS: { id: View; label: string; icon: string }[] = [
  { id: "all", label: "All notes", icon: "notes" },
  { id: "pinned", label: "Pinned", icon: "pin" },
  { id: "shared", label: "Shared with me", icon: "users" },
  { id: "archive", label: "Archive", icon: "archive" },
  { id: "trash", label: "Trash", icon: "trash" },
];

const SORTS = [
  { value: "updated", label: "Last edited" },
  { value: "created", label: "Newest first" },
  { value: "title", label: "Title A–Z" },
];

// ── the open note lives in the address (?id=…), so it can be linked ─────

const urlListeners = new Set<() => void>();

function useOpenNote(): [string | null, (id: string | null) => void] {
  const id = useSyncExternalStore(
    (cb) => {
      urlListeners.add(cb);
      window.addEventListener("popstate", cb);
      return () => {
        urlListeners.delete(cb);
        window.removeEventListener("popstate", cb);
      };
    },
    () => new URLSearchParams(location.search).get("id"),
    () => null
  );
  const open = useCallback((next: string | null) => {
    const url = new URL(location.href);
    if (next) url.searchParams.set("id", next);
    else url.searchParams.delete("id");
    history.replaceState(null, "", url);
    urlListeners.forEach((l) => l());
  }, []);
  return [id, open];
}

/** Where in the notebook: a view, optionally narrowed to one folder or tag. */
type Scope = { view: View; folder: string | null; tag: string | null };

export default function NotesPage() {
  const [scope, setScope] = useState<Scope>({ view: "all", folder: null, tag: null });
  const [project, setProject] = useState("");
  const [sort, setSort] = useState<Sort>("updated");
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  const [book, setBook] = useState<Notebook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, open] = useOpenNote();
  const [reloads, setReloads] = useState(0);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [deletingFolder, setDeletingFolder] = useState<{ id: string; name: string } | null>(null);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const loadSeq = useRef(0);

  // Search as you type, without a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setQ(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  const load = useCallback(() => setReloads((n) => n + 1), []);

  useEffect(() => {
    const seq = ++loadSeq.current;
    const p = new URLSearchParams({ view: scope.view, sort });
    if (scope.folder) p.set("folder", scope.folder);
    if (scope.tag) p.set("tag", scope.tag);
    if (project) p.set("project", project);
    if (q) p.set("q", q);
    fetch(`/api/notes?${p}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Could not load notes");
        if (seq === loadSeq.current) {
          setBook(data);
          setError(null);
        }
      })
      .catch((err) => seq === loadSeq.current && setError(err instanceof Error ? err.message : "Could not load notes"));
  }, [scope, sort, project, q, reloads]);

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => (r.ok ? r.json() : { projects: [] }))
      .then((d) => setProjects((d.projects ?? []).map((p: { id: string; name: string }) => ({ id: p.id, name: p.name }))))
      .catch(() => {});
  }, []);

  async function createNote(input: { title?: string; content?: string; tags?: string[] } = {}) {
    setTemplatesOpen(false);
    const res = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // A new note lands where you're looking: the open folder, project, or as a pin.
      body: JSON.stringify({
        ...input,
        tags: [...new Set([...(input.tags ?? []), ...(scope.tag ? [scope.tag] : [])])],
        folderId: scope.folder && scope.folder !== "none" ? scope.folder : undefined,
        projectId: project && project !== "none" ? project : undefined,
        pinned: scope.view === "pinned" || undefined,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Could not create the note");
      return;
    }
    if (scope.view !== "all" && scope.view !== "pinned") setScope({ view: "all", folder: scope.folder, tag: scope.tag });
    open(data.note.id);
    load();
  }

  const fromTemplate = (t: NoteTemplate) => createNote(fillTemplate(t));

  /** The open note was saved: update its row in place, so the list doesn't jump while typing. */
  const onSaved = useCallback((note: NoteDetail) => {
    setBook((b) =>
      b && {
        ...b,
        notes: b.notes.map((n) =>
          n.id === note.id
            ? { ...n, title: note.title, excerpt: excerpt(note.content), checklist: checklist(note.content), updatedAt: note.updatedAt, updatedBy: note.updatedBy }
            : n
        ),
      }
    );
  }, []);

  async function folderRequest(url: string, method: string, body?: unknown) {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setError(data.error ?? "That didn't work");
    return res.ok ? data : null;
  }

  async function addFolder() {
    const name = newFolder?.trim();
    setNewFolder(null);
    if (!name) return;
    const data = await folderRequest("/api/notes/folders", "POST", { name });
    if (data) {
      setScope({ view: "all", folder: data.folder.id, tag: null });
    }
  }

  async function saveRename() {
    if (!renaming) return;
    const { id, name } = renaming;
    setRenaming(null);
    if (name.trim()) await folderRequest(`/api/notes/folders/${id}`, "PATCH", { name });
    load();
  }

  async function removeFolder() {
    if (!deletingFolder) return;
    await folderRequest(`/api/notes/folders/${deletingFolder.id}`, "DELETE");
    if (scope.folder === deletingFolder.id) setScope({ view: "all", folder: null, tag: null });
    setDeletingFolder(null);
    load();
  }

  async function emptyTrash() {
    await folderRequest("/api/notes/trash", "DELETE");
    setConfirmEmpty(false);
    if (scope.view === "trash") open(null);
    load();
  }

  const heading = scope.folder
    ? (book?.folders.find((f) => f.id === scope.folder)?.name ?? "Folder")
    : scope.tag
      ? `#${scope.tag}`
      : VIEWS.find((v) => v.id === scope.view)!.label;

  return (
    <>
      <TopStrip crumb="Nonaki / Notes" right={<span>{book ? `${book.counts.all} NOTES` : "…"}</span>} />
      <div className="flex min-h-0 flex-1">
        {/* notebook */}
        <aside className="flex w-[214px] flex-none flex-col border-r border-hairline bg-panel">
          <div className="relative p-3">
            <div className="flex">
              <button
                onClick={() => void createNote()}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-l-lg bg-teal px-3 py-2 text-[12px] font-semibold text-white hover:bg-teal-dark"
              >
                <Icon name="plus" size={13} /> New note
              </button>
              <button
                onClick={() => setTemplatesOpen((v) => !v)}
                title="New from a template"
                aria-label="New from a template"
                className="rounded-r-lg border-l border-teal-dark bg-teal px-2 text-white hover:bg-teal-dark"
              >
                <Icon name="chevron-down" size={13} />
              </button>
            </div>
            {templatesOpen && (
              <>
                <button className="fixed inset-0 z-20 cursor-default" aria-label="Close templates" onClick={() => setTemplatesOpen(false)} />
                <div className="absolute left-3 right-3 top-[calc(100%-4px)] z-30 overflow-hidden rounded-lg border border-line bg-card py-1 shadow-[0_8px_28px_rgba(10,20,25,0.14)]">
                  {NOTE_TEMPLATES.map((t) => (
                    <button key={t.id} onClick={() => void fromTemplate(t)} className="block w-full px-3 py-1.5 text-left hover:bg-hover">
                      <span className="block text-[12px] text-ink">{t.label}</span>
                      <span className="block text-[10.5px] text-muted">{t.hint}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <nav className="min-h-0 flex-1 overflow-y-auto scrollbar-thin px-2 pb-4">
            {VIEWS.map((v) => (
              <SideItem
                key={v.id}
                icon={v.icon}
                label={v.label}
                count={book?.counts[v.id]}
                active={scope.view === v.id && !scope.folder && !scope.tag}
                onClick={() => setScope({ view: v.id, folder: null, tag: null })}
              />
            ))}

            <SideHeading
              action={
                <button onClick={() => setNewFolder("")} title="New folder" aria-label="New folder" className="text-faint hover:text-teal">
                  <Icon name="plus" size={12} />
                </button>
              }
            >
              Folders
            </SideHeading>
            {newFolder !== null && (
              <input
                autoFocus
                value={newFolder}
                onChange={(e) => setNewFolder(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void addFolder();
                  if (e.key === "Escape") setNewFolder(null);
                }}
                onBlur={() => void addFolder()}
                placeholder="Folder name"
                maxLength={80}
                className="mx-1 mb-1 w-[calc(100%-8px)] rounded-md border border-teal bg-card px-2 py-1 text-[12px] outline-none"
              />
            )}
            {book?.folders.map((f) =>
              renaming?.id === f.id ? (
                <input
                  key={f.id}
                  autoFocus
                  value={renaming.name}
                  onChange={(e) => setRenaming({ id: f.id, name: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void saveRename();
                    if (e.key === "Escape") setRenaming(null);
                  }}
                  onBlur={() => void saveRename()}
                  maxLength={80}
                  className="mx-1 mb-1 w-[calc(100%-8px)] rounded-md border border-teal bg-card px-2 py-1 text-[12px] outline-none"
                />
              ) : (
                <SideItem
                  key={f.id}
                  icon="folder"
                  label={f.name}
                  count={f.count}
                  active={scope.folder === f.id}
                  onClick={() => setScope({ view: "all", folder: f.id, tag: null })}
                  actions={
                    <>
                      <button onClick={() => setRenaming({ id: f.id, name: f.name })} title="Rename" aria-label={`Rename ${f.name}`} className="hover:text-teal">
                        <Icon name="edit" size={11} />
                      </button>
                      <button onClick={() => setDeletingFolder(f)} title="Delete folder" aria-label={`Delete ${f.name}`} className="hover:text-orange">
                        <Icon name="trash" size={11} />
                      </button>
                    </>
                  }
                />
              )
            )}
            {book && book.folders.length === 0 && newFolder === null && <p className="px-3 py-1 text-[11px] text-faint">No folders yet.</p>}

            {book && book.tags.length > 0 && (
              <>
                <SideHeading>Tags</SideHeading>
                <div className="flex flex-wrap gap-1 px-2">
                  {book.tags.map((t) => (
                    <button
                      key={t.name}
                      onClick={() => setScope(scope.tag === t.name ? { view: "all", folder: null, tag: null } : { view: "all", folder: null, tag: t.name })}
                      className={`rounded-full px-2 py-0.5 text-[11px] ${scope.tag === t.name ? "bg-teal-soft font-semibold text-teal-dark" : "bg-chip text-slate hover:text-teal"}`}
                    >
                      #{t.name} <span className="text-faint">{t.count}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </nav>
        </aside>

        {/* list */}
        <section className="flex w-[318px] flex-none flex-col border-r border-hairline">
          <div className="flex-none border-b border-hairline px-4 pb-3 pt-4">
            <div className="flex items-baseline gap-2">
              <h1 className="truncate text-[17px] font-semibold tracking-[-0.01em]">{heading}</h1>
              {book && <span className="text-[11px] text-muted">{book.notes.length}{book.truncated ? "+" : ""}</span>}
              {scope.view === "trash" && book && book.notes.length > 0 && (
                <button onClick={() => setConfirmEmpty(true)} className="ml-auto text-[11px] text-orange hover:underline">
                  Empty trash
                </button>
              )}
            </div>
            <label className="mt-2.5 flex items-center gap-2 rounded-full border border-edge bg-card px-3 py-1 focus-within:border-teal">
              <Icon name="ask" size={12} className="flex-none text-faint" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search notes, or #tag…"
                className="w-full bg-transparent text-[11.5px] outline-none placeholder:text-faint"
              />
              {query && (
                <button onClick={() => setQuery("")} aria-label="Clear search" className="text-faint hover:text-ink">
                  <Icon name="x" size={11} />
                </button>
              )}
            </label>
            <div className="mt-2 flex gap-1.5">
              <FilterSelect options={SORTS} value={sort} onChange={(v) => setSort((v || "updated") as Sort)} width="w-36" />
              <FilterSelect
                options={[{ value: "", label: "Any project" }, { value: "none", label: "No project" }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
                value={project}
                onChange={setProject}
                width="w-56"
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
            {error && <div className="m-3 rounded-lg border border-warn-line bg-warn-bg px-3 py-2 text-[11.5px] text-warn-text">{error}</div>}
            {!book && !error && <ListRowsSkeleton rows={7} icon={false} />}
            {book && book.notes.length === 0 && <EmptyList view={scope.view} searching={Boolean(q)} onCreate={() => void createNote()} />}
            {book?.notes.map((n) => (
              <NoteListRow key={n.id} note={n} active={n.id === selected} me={book.me} onClick={() => open(n.id)} />
            ))}
            {book?.truncated && <p className="px-4 py-3 text-[11px] text-muted">Showing the first 500. Search or pick a folder to narrow it down.</p>}
          </div>
        </section>

        {/* editor */}
        {selected ? (
          <NotePane
            key={selected}
            id={selected}
            folders={book?.folders ?? []}
            projects={projects}
            onSaved={onSaved}
            onMetaChanged={() => void load()}
            onOpen={(id) => open(id)}
            onCreateLinked={(title) => void createNote({ title })}
            onGone={() => {
              open(null);
              load();
            }}
          />
        ) : (
          <div className="grid flex-1 place-items-center p-10">
            <div className="max-w-sm text-center">
              <div className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-teal-soft text-teal-dark">
                <Icon name="notes" size={20} />
              </div>
              <h2 className="mt-3 text-[15px] font-semibold">Pick a note, or start a new one</h2>
              <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
                Notes save as you type and keep their history. Add checklists with &ldquo;/&rdquo;, link notes with [[Note title]], share one with the
                team, turn its action items into tasks, or add it to the knowledge base so Ask can answer from it.
              </p>
              <button onClick={() => void createNote()} className="mt-4 rounded-lg bg-teal px-4 py-2 text-[12px] font-semibold text-white hover:bg-teal-dark">
                New note
              </button>
            </div>
          </div>
        )}
      </div>

      <DeleteConfirmDialog
        open={Boolean(deletingFolder)}
        title={`Delete the folder "${deletingFolder?.name ?? ""}"?`}
        description="The notes in it stay; they just won't be in a folder any more."
        confirmLabel="Delete folder"
        tone="danger"
        onCancel={() => setDeletingFolder(null)}
        onConfirm={() => void removeFolder()}
      />
      <DeleteConfirmDialog
        open={confirmEmpty}
        title="Empty the trash?"
        description={`${book?.counts.trash ?? 0} note${book?.counts.trash === 1 ? "" : "s"} will be deleted for good, with their history. This can't be undone.`}
        warning="Any of them in the knowledge base are removed from it too."
        confirmLabel="Empty trash"
        tone="danger"
        onCancel={() => setConfirmEmpty(false)}
        onConfirm={() => void emptyTrash()}
      />
    </>
  );
}

function SideHeading({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-1 mt-4 flex items-center px-3 font-mono text-[9.5px] tracking-[0.1em] text-muted">
      <span className="uppercase">{children}</span>
      <span className="ml-auto">{action}</span>
    </div>
  );
}

function SideItem({
  icon,
  label,
  count,
  active,
  onClick,
  actions,
}: {
  icon: string;
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
  actions?: React.ReactNode;
}) {
  return (
    <div
      className={`group flex items-center rounded-lg text-[12.5px] transition-colors ${
        active ? "bg-card font-semibold text-teal-dark shadow-[0_1px_3px_rgba(20,40,45,0.08)]" : "text-slate hover:bg-railhover hover:text-ink"
      }`}
    >
      <button onClick={onClick} className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-1.5 text-left">
        <span className={active ? "text-teal" : "text-muted"}>
          <Icon name={icon} size={14} />
        </span>
        <span className="truncate">{label}</span>
      </button>
      {actions && <span className="hidden flex-none items-center gap-1.5 pr-1 text-faint group-hover:flex">{actions}</span>}
      {count !== undefined && count > 0 && <span className={`flex-none pr-3 font-mono text-[10px] text-faint ${actions ? "group-hover:hidden" : ""}`}>{count}</span>}
    </div>
  );
}

function NoteListRow({ note, active, me, onClick }: { note: NoteRow; active: boolean; me: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`block w-full border-b border-hairline-2 px-4 py-3 text-left transition-colors ${active ? "bg-teal-mist" : "hover:bg-hover"}`}
    >
      <div className="flex items-center gap-1.5">
        {note.pinned && !note.trashedAt && <Icon name="pin" size={11} className="flex-none text-teal" />}
        <span className={`truncate text-[13px] font-semibold ${note.title ? "text-ink" : "text-faint"}`}>{note.title || "Untitled note"}</span>
        <span className="ml-auto flex flex-none items-center gap-1 text-faint">
          {note.shared && <Icon name="users" size={11} className={note.owner === me ? "text-teal" : "text-faint"} />}
          {note.documentId && <Icon name="book" size={11} className={note.publishStale ? "text-amber" : "text-green"} />}
        </span>
      </div>
      <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-muted">{note.excerpt || "No text yet"}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-faint">
        <span>{timeAgo(note.trashedAt ?? note.updatedAt)}</span>
        {!note.mine && <span>· by {note.owner.split("@")[0]}</span>}
        {note.checklist.total > 0 && (
          <span className={note.checklist.done === note.checklist.total ? "text-green" : ""}>
            · ☑ {note.checklist.done}/{note.checklist.total}
          </span>
        )}
        {note.tags.slice(0, 3).map((t) => (
          <span key={t} className="rounded-full bg-chip px-1.5 text-slate">
            #{t}
          </span>
        ))}
        {note.tags.length > 3 && <span>+{note.tags.length - 3}</span>}
      </div>
    </button>
  );
}

function EmptyList({ view, searching, onCreate }: { view: View; searching: boolean; onCreate: () => void }) {
  const text = searching
    ? "No notes match that search."
    : {
        all: "No notes here yet.",
        pinned: "Pin a note to keep it at the top.",
        shared: "Nobody has shared a note with you yet.",
        archive: "Archived notes show up here.",
        trash: "The trash is empty. Notes stay here for 30 days.",
      }[view];
  return (
    <div className="px-4 py-10 text-center text-[12px] text-muted">
      <p>{text}</p>
      {(view === "all" || view === "pinned") && !searching && (
        <button onClick={onCreate} className="mt-2 text-teal hover:underline">
          Write one
        </button>
      )}
    </div>
  );
}
