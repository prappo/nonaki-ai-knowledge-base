import { prisma } from "./prisma";
import { deindexDocuments } from "./indexer";
import type { Prisma } from "@/generated/prisma/client";
import { checklist, excerpt, wikiLinks } from "./noteText";

export { checklist, excerpt, wikiLinks };

/**
 * Notes: markdown notes owned by one user, in folders, with tags, pins,
 * archive and trash, version history, [[wiki links]], and an optional copy
 * in the knowledge base.
 *
 * Access: a note is visible to its owner, and to everyone once it is shared.
 * Anyone who can see a note can edit its text; only the owner can share,
 * move to a folder, archive, trash or delete it.
 *
 * Bad input throws NoteError; the routes map `status` to an HTTP error.
 */

export class NoteError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 409 = 400) {
    super(message);
  }
}

export function noteErrorResponse(err: unknown): Response {
  if (err instanceof NoteError) return Response.json({ error: err.message }, { status: err.status });
  throw err;
}

/** Someone with no session (Supabase not set up) still gets one notebook. */
export const LOCAL_OWNER = "system";

export const TRASH_DAYS = 30;
/** While someone keeps typing, keep at most one snapshot per this long. */
const SNAPSHOT_EVERY_MS = 10 * 60 * 1000;
const MAX_TITLE = 300;
const MAX_CONTENT = 500_000;
const MAX_TAGS = 20;

export type NoteView = "all" | "pinned" | "shared" | "archive" | "trash";
const VIEWS: NoteView[] = ["all", "pinned", "shared", "archive", "trash"];
export const isNoteView = (v: unknown): v is NoteView => VIEWS.includes(v as NoteView);

export type NoteSort = "updated" | "created" | "title";

/** What the list shows: everything but the content, plus a short excerpt. */
const LIST_SELECT = {
  id: true,
  owner: true,
  title: true,
  content: true,
  folderId: true,
  projectId: true,
  tags: true,
  pinned: true,
  shared: true,
  documentId: true,
  publishedAt: true,
  archivedAt: true,
  trashedAt: true,
  createdAt: true,
  updatedAt: true,
  updatedBy: true,
} satisfies Prisma.NoteSelect;

type ListRow = Prisma.NoteGetPayload<{ select: typeof LIST_SELECT }>;

function toListItem(row: ListRow, me: string) {
  const { content, ...rest } = row;
  return {
    ...rest,
    excerpt: excerpt(content),
    checklist: checklist(content),
    mine: row.owner === me,
    /** Edited since its knowledge base copy was refreshed. */
    publishStale: Boolean(row.documentId && row.publishedAt && row.updatedAt > row.publishedAt),
  };
}

/** Who can see a note: its owner, or anyone once it is shared. */
const visibleTo = (me: string): Prisma.NoteWhereInput => ({ OR: [{ owner: me }, { shared: true }] });

async function findVisible(id: string, me: string) {
  const note = await prisma.note.findFirst({ where: { id, ...visibleTo(me) } });
  if (!note) throw new NoteError("Note not found", 404);
  return note;
}

async function findOwned(id: string, me: string) {
  const note = await findVisible(id, me);
  if (note.owner !== me) throw new NoteError("Only the note's owner can do that.", 403);
  return note;
}

/**
 * Remove notes for good, with their knowledge base copies. A copy that can't
 * be taken out of the search index (Weaviate down) is still deleted here.
 */
async function destroyNotes(where: Prisma.NoteWhereInput) {
  const notes = await prisma.note.findMany({ where, select: { id: true, title: true, documentId: true } });
  if (notes.length === 0) return notes;
  const documentIds = notes.map((n) => n.documentId).filter((d): d is string => Boolean(d));
  if (documentIds.length) {
    await deindexDocuments(documentIds).catch(() => {});
    await prisma.document.deleteMany({ where: { id: { in: documentIds } } });
  }
  await prisma.note.deleteMany({ where: { id: { in: notes.map((n) => n.id) } } });
  return notes;
}

/** Empty the trash of notes binned more than TRASH_DAYS ago. */
async function purgeTrash(me: string) {
  const cutoff = new Date(Date.now() - TRASH_DAYS * 86_400_000);
  await destroyNotes({ owner: me, trashedAt: { lt: cutoff } });
}

// ── reads ────────────────────────────────────────────────────────────────

export type NoteFilters = {
  view?: string | null;
  folder?: string | null;
  tag?: string | null;
  project?: string | null;
  q?: string | null;
  sort?: string | null;
};

export async function listNotes(filters: NoteFilters, me: string, limit = 500) {
  await purgeTrash(me);
  const view: NoteView = isNoteView(filters.view) ? filters.view : "all";
  const and: Prisma.NoteWhereInput[] = [];

  if (view === "trash") and.push({ owner: me, trashedAt: { not: null } });
  else {
    and.push({ trashedAt: null });
    if (view === "archive") and.push({ owner: me, archivedAt: { not: null } });
    else {
      and.push({ archivedAt: null });
      if (view === "shared") and.push({ shared: true, owner: { not: me } });
      else and.push(visibleTo(me));
      if (view === "pinned") and.push({ pinned: true });
    }
  }

  if (filters.folder === "none") and.push({ folderId: null, owner: me });
  else if (filters.folder) and.push({ folderId: filters.folder });
  if (filters.tag) and.push({ tags: { has: filters.tag.toLowerCase() } });
  if (filters.project === "none") and.push({ projectId: null });
  else if (filters.project) and.push({ projectId: filters.project });

  const q = filters.q?.trim().slice(0, 200);
  if (q) {
    and.push({
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { content: { contains: q, mode: "insensitive" } },
        { tags: { has: q.replace(/^#/, "").toLowerCase() } },
      ],
    });
  }

  const orderBy: Prisma.NoteOrderByWithRelationInput[] =
    filters.sort === "title"
      ? [{ title: "asc" }]
      : filters.sort === "created"
        ? [{ createdAt: "desc" }]
        : [{ updatedAt: "desc" }];
  // Pins float to the top of every view but Trash.
  if (view !== "trash") orderBy.unshift({ pinned: "desc" });

  const rows = await prisma.note.findMany({ where: { AND: and }, orderBy, take: limit + 1, select: LIST_SELECT });
  return { notes: rows.slice(0, limit).map((r) => toListItem(r, me)), truncated: rows.length > limit, view };
}

/** The sidebar: folders with counts, tags with counts, and each view's size. */
export async function notebookSummary(me: string) {
  const live: Prisma.NoteWhereInput = { trashedAt: null, archivedAt: null };
  const [folders, folderCounts, tagged, all, pinned, shared, archive, trash] = await Promise.all([
    prisma.noteFolder.findMany({ where: { owner: me }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] }),
    prisma.note.groupBy({ by: ["folderId"], where: { owner: me, ...live }, _count: true }),
    prisma.note.findMany({ where: { ...live, ...visibleTo(me), NOT: { tags: { isEmpty: true } } }, select: { tags: true } }),
    prisma.note.count({ where: { ...live, ...visibleTo(me) } }),
    prisma.note.count({ where: { ...live, ...visibleTo(me), pinned: true } }),
    prisma.note.count({ where: { ...live, shared: true, owner: { not: me } } }),
    prisma.note.count({ where: { owner: me, trashedAt: null, archivedAt: { not: null } } }),
    prisma.note.count({ where: { owner: me, trashedAt: { not: null } } }),
  ]);

  const byFolder = new Map(folderCounts.map((c) => [c.folderId, c._count]));
  const tags = new Map<string, number>();
  for (const { tags: list } of tagged) for (const t of list) tags.set(t, (tags.get(t) ?? 0) + 1);

  return {
    folders: folders.map((f) => ({ id: f.id, name: f.name, count: byFolder.get(f.id) ?? 0 })),
    tags: [...tags.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, count]) => ({ name, count })),
    counts: { all, pinned, shared, archive, trash },
  };
}

/** One note, with the notes it links to and the notes that link to it. */
export async function getNote(id: string, me: string) {
  const note = await findVisible(id, me);
  const titles = wikiLinks(note.content);

  const [linked, backlinks, versionCount, project, kbCopy] = await Promise.all([
    titles.length
      ? prisma.note.findMany({
          where: { trashedAt: null, ...visibleTo(me), OR: titles.map((t) => ({ title: { equals: t, mode: "insensitive" as const } })) },
          select: { id: true, title: true },
        })
      : [],
    note.title.trim()
      ? prisma.note.findMany({
          where: {
            id: { not: note.id },
            trashedAt: null,
            ...visibleTo(me),
            content: { contains: `[[${note.title.trim()}]]`, mode: "insensitive" },
          },
          select: { id: true, title: true, updatedAt: true },
          orderBy: { updatedAt: "desc" },
          take: 50,
        })
      : [],
    prisma.noteVersion.count({ where: { noteId: note.id } }),
    note.projectId ? prisma.project.findUnique({ where: { id: note.projectId }, select: { id: true, name: true } }) : null,
    note.documentId ? prisma.document.findUnique({ where: { id: note.documentId }, select: { id: true } }) : null,
  ]);
  // Someone may have deleted the copy from the Documents page.
  const published = Boolean(kbCopy);

  const byTitle = new Map(linked.map((n) => [n.title.toLowerCase(), n.id]));
  return {
    note: {
      ...note,
      mine: note.owner === me,
      checklist: checklist(note.content),
      documentId: published ? note.documentId : null,
      publishStale: Boolean(published && note.publishedAt && note.updatedAt > note.publishedAt),
      project,
    },
    links: titles.map((title) => ({ title, id: byTitle.get(title.toLowerCase()) ?? null })),
    backlinks,
    versionCount,
  };
}

// ── writes ───────────────────────────────────────────────────────────────

function text(v: unknown, label: string, max: number): string {
  if (typeof v !== "string") throw new NoteError(`${label} must be text`);
  if (v.length > max) throw new NoteError(`${label} is too long`);
  return v;
}

/** Lowercase, trimmed, de-duplicated tags without a leading #. */
export function parseTags(v: unknown): string[] {
  if (!Array.isArray(v)) throw new NoteError("tags must be a list");
  const tags = [
    ...new Set(
      v
        .filter((t): t is string => typeof t === "string")
        .map((t) => t.trim().replace(/^#+/, "").toLowerCase().replace(/\s+/g, "-").slice(0, 40))
        .filter(Boolean)
    ),
  ];
  if (tags.length > MAX_TAGS) throw new NoteError(`A note can have at most ${MAX_TAGS} tags`);
  return tags;
}

async function folderField(v: unknown, me: string): Promise<string | null> {
  if (v === null || v === "") return null;
  if (typeof v !== "string") throw new NoteError("folderId must be a folder id");
  const folder = await prisma.noteFolder.findFirst({ where: { id: v, owner: me } });
  if (!folder) throw new NoteError("Folder not found", 404);
  return folder.id;
}

async function projectField(v: unknown): Promise<string | null> {
  if (v === null || v === "") return null;
  if (typeof v !== "string") throw new NoteError("projectId must be a project id");
  const project = await prisma.project.findUnique({ where: { id: v }, select: { id: true } });
  if (!project) throw new NoteError("Project not found", 404);
  return project.id;
}

export async function createNote(input: Record<string, unknown>, me: string) {
  return prisma.note.create({
    data: {
      owner: me,
      updatedBy: me,
      title: input.title === undefined ? "" : text(input.title, "Title", MAX_TITLE).trim(),
      content: input.content === undefined ? "" : text(input.content, "Content", MAX_CONTENT),
      tags: input.tags === undefined ? [] : parseTags(input.tags),
      pinned: input.pinned === true,
      folderId: input.folderId === undefined ? null : await folderField(input.folderId, me),
      projectId: input.projectId === undefined ? null : await projectField(input.projectId),
    },
  });
}

/** Fields only the owner may change. */
const OWNER_FIELDS = ["shared", "folderId", "archived", "trashed"] as const;

/**
 * Update a note. `expectedUpdatedAt` (the updatedAt the editor last saw)
 * turns a save into a conflict when someone else saved in between, instead of
 * silently overwriting them.
 */
export async function updateNote(id: string, input: Record<string, unknown>, me: string) {
  const note = await findVisible(id, me);
  if (note.trashedAt && input.trashed !== false) throw new NoteError("Restore the note from the trash to edit it.", 409);
  if (note.owner !== me && OWNER_FIELDS.some((f) => input[f] !== undefined)) {
    throw new NoteError("Only the note's owner can do that.", 403);
  }

  if (typeof input.expectedUpdatedAt === "string" && new Date(input.expectedUpdatedAt).getTime() !== note.updatedAt.getTime()) {
    throw new NoteError(`${note.updatedBy && note.updatedBy !== me ? note.updatedBy : "Another window"} changed this note since you opened it.`, 409);
  }

  const data: Prisma.NoteUncheckedUpdateInput = {};
  if (input.title !== undefined) data.title = text(input.title, "Title", MAX_TITLE).trim();
  if (input.content !== undefined) data.content = text(input.content, "Content", MAX_CONTENT);
  if (input.tags !== undefined) data.tags = parseTags(input.tags);
  if (input.pinned !== undefined) data.pinned = input.pinned === true;
  if (input.shared !== undefined) data.shared = input.shared === true;
  if (input.folderId !== undefined) data.folderId = await folderField(input.folderId, me);
  if (input.projectId !== undefined) data.projectId = await projectField(input.projectId);
  if (input.archived !== undefined) data.archivedAt = input.archived === true ? new Date() : null;
  if (input.trashed !== undefined) data.trashedAt = input.trashed === true ? new Date() : null;

  const textChanged =
    (data.title !== undefined && data.title !== note.title) || (data.content !== undefined && data.content !== note.content);
  if (Object.keys(data).length === 0) return note;
  if (textChanged) data.updatedBy = me;
  // Only a change to the text counts as an update: pinning or filing a note
  // doesn't reorder the list, mark its knowledge base copy out of date, or
  // conflict with an open editor.
  else data.updatedAt = note.updatedAt;

  return prisma.$transaction(async (tx) => {
    if (textChanged && (await snapshotDue(tx, note))) {
      await tx.noteVersion.create({
        data: { noteId: note.id, version: note.version, title: note.title, content: note.content, editedBy: note.updatedBy },
      });
      data.version = note.version + 1;
    }
    return tx.note.update({ where: { id: note.id }, data });
  });
}

/**
 * Whether this edit should first keep the note's current text as a version:
 * when there is something to keep, and the last snapshot (or the note's
 * creation) is old enough. Autosave then keeps one version per editing
 * session instead of one per keystroke pause.
 */
async function snapshotDue(tx: Prisma.TransactionClient, note: { id: string; title: string; content: string; createdAt: Date }) {
  if (!note.title.trim() && !note.content.trim()) return false;
  const last = await tx.noteVersion.findFirst({ where: { noteId: note.id }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  const since = (last?.createdAt ?? note.createdAt).getTime();
  return Date.now() - since >= SNAPSHOT_EVERY_MS;
}

/** Delete forever: only from the trash, and only by the owner. */
export async function deleteNote(id: string, me: string) {
  const note = await findOwned(id, me);
  if (!note.trashedAt) throw new NoteError("Move the note to the trash first.", 409);
  await destroyNotes({ id: note.id });
  return note;
}

export async function emptyTrash(me: string) {
  return destroyNotes({ owner: me, trashedAt: { not: null } });
}

// ── versions ─────────────────────────────────────────────────────────────

/** The note's earlier versions, newest first, in the shape the version history dialog reads. */
export async function listVersions(id: string, me: string) {
  const note = await findVisible(id, me);
  const versions = await prisma.noteVersion.findMany({
    where: { noteId: note.id },
    orderBy: { version: "desc" },
    take: 100,
    select: { id: true, version: true, title: true, editedBy: true, createdAt: true },
  });
  return { versions: versions.map((v) => ({ ...v, origin: "edit" })) };
}

export async function getVersion(id: string, versionId: string, me: string) {
  const note = await findVisible(id, me);
  const version = await prisma.noteVersion.findFirst({ where: { id: versionId, noteId: note.id } });
  if (!version) throw new NoteError("Version not found", 404);
  return version;
}

/** Put an old version back. The text it replaces is kept as a version first. */
export async function restoreVersion(id: string, versionId: unknown, me: string) {
  const note = await findVisible(id, me);
  if (note.trashedAt) throw new NoteError("Restore the note from the trash first.", 409);
  if (typeof versionId !== "string") throw new NoteError("versionId is required");
  const version = await prisma.noteVersion.findFirst({ where: { id: versionId, noteId: note.id } });
  if (!version) throw new NoteError("Version not found", 404);

  return prisma.$transaction(async (tx) => {
    await tx.noteVersion.create({
      data: { noteId: note.id, version: note.version, title: note.title, content: note.content, editedBy: note.updatedBy },
    });
    return tx.note.update({
      where: { id: note.id },
      data: { title: version.title, content: version.content, version: note.version + 1, updatedBy: me },
    });
  });
}

// ── folders ──────────────────────────────────────────────────────────────

function folderName(v: unknown): string {
  const name = typeof v === "string" ? v.trim() : "";
  if (!name) throw new NoteError("Give the folder a name");
  if (name.length > 80) throw new NoteError("Folder name is too long");
  return name;
}

export async function createFolder(input: Record<string, unknown>, me: string) {
  const last = await prisma.noteFolder.aggregate({ where: { owner: me }, _max: { position: true } });
  return prisma.noteFolder.create({ data: { owner: me, name: folderName(input.name), position: (last._max.position ?? -1) + 1 } });
}

export async function renameFolder(id: string, input: Record<string, unknown>, me: string) {
  const folder = await prisma.noteFolder.findFirst({ where: { id, owner: me } });
  if (!folder) throw new NoteError("Folder not found", 404);
  return prisma.noteFolder.update({ where: { id }, data: { name: folderName(input.name) } });
}

/** Delete a folder. Its notes stay, outside any folder. */
export async function deleteFolder(id: string, me: string) {
  const folder = await prisma.noteFolder.findFirst({ where: { id, owner: me } });
  if (!folder) throw new NoteError("Folder not found", 404);
  await prisma.noteFolder.delete({ where: { id } });
}

// ── access for other features ────────────────────────────────────────────

export { findVisible as visibleNote, findOwned as ownedNote };
