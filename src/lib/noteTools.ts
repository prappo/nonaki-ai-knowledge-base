import { prisma } from "./prisma";
import { chatComplete } from "./llm";
import { deindexDocument, indexDocument, log } from "./indexer";
import { audit } from "./audit";
import { createTask, parseNewTask } from "./projectStore";
import { NoteError, excerpt, ownedNote, visibleNote } from "./notes";

/**
 * What a note can do beyond being edited: go into the knowledge base (so Ask,
 * search, the widget and MCP clients can find it), and be read by the AI for
 * a summary or its action items.
 */

// ── knowledge base ───────────────────────────────────────────────────────

/** Notes go in with the uploads, keyed by note id, so a re-publish updates the same document. */
async function uploadSource() {
  const existing = await prisma.source.findFirst({ where: { type: "upload" } });
  return existing ?? prisma.source.create({ data: { type: "upload", name: "File uploads", status: "connected" } });
}

const externalId = (noteId: string) => `note:${noteId}`;

/** Put the note in the knowledge base, or refresh its copy there. Owner only. */
export async function publishNote(id: string, me: string) {
  const note = await ownedNote(id, me);
  if (note.trashedAt) throw new NoteError("Restore the note from the trash first.", 409);
  if (!note.content.trim()) throw new NoteError("Write something first: an empty note can't go into the knowledge base.");

  const source = await uploadSource();
  const title = note.title.trim() || "Untitled note";
  const doc = await prisma.document.upsert({
    where: { sourceId_externalId: { sourceId: source.id, externalId: externalId(note.id) } },
    create: { sourceId: source.id, externalId: externalId(note.id), title, content: note.content, excerpt: excerpt(note.content, 300), kind: "note" },
    update: { title, content: note.content, excerpt: excerpt(note.content, 300), status: "indexed", archivedAt: null, version: { increment: 1 } },
  });

  let chunks: number;
  try {
    chunks = await indexDocument(doc.id);
  } catch (err) {
    throw new NoteError(`Saved to Documents, but indexing failed: ${err instanceof Error ? err.message : "unknown error"}. Try again.`, 409);
  }

  const first = !note.documentId || note.documentId !== doc.id;
  // Keep updatedAt: publishing isn't an edit, and the copy now matches it.
  await prisma.note.update({ where: { id: note.id }, data: { documentId: doc.id, publishedAt: new Date(), updatedAt: note.updatedAt } });
  await log(`Note "${title}" ${first ? "added to" : "refreshed in"} the knowledge base → ${chunks} chunks indexed`, { sourceId: source.id });
  await audit(first ? "note.published" : "note.republished", `${first ? "Added" : "Refreshed"} the note "${title}" in the knowledge base`, {
    entityType: "document",
    entityId: doc.id,
    actor: me,
  });
  return { documentId: doc.id, chunks };
}

/** Take the note's copy out of the knowledge base. The note itself stays. */
export async function unpublishNote(id: string, me: string) {
  const note = await ownedNote(id, me);
  if (note.documentId) {
    const doc = await prisma.document.findUnique({ where: { id: note.documentId }, select: { id: true, title: true } });
    if (doc) {
      await deindexDocument(doc.id).catch(() => {});
      await prisma.document.delete({ where: { id: doc.id } });
      await audit("note.unpublished", `Removed the note "${doc.title}" from the knowledge base`, { entityType: "document", entityId: doc.id, actor: me });
    }
  }
  await prisma.note.update({ where: { id: note.id }, data: { documentId: null, publishedAt: null, updatedAt: note.updatedAt } });
}

// ── AI ───────────────────────────────────────────────────────────────────

/** Enough of a note for the model, without sending a novel. */
function forModel(note: { title: string; content: string }) {
  const body = note.content.length > 24_000 ? `${note.content.slice(0, 24_000)}\n\n[…the rest of the note is cut off]` : note.content;
  return `Title: ${note.title.trim() || "(untitled)"}\n\n${body}`;
}

export async function summarizeNote(id: string, me: string): Promise<string> {
  const note = await visibleNote(id, me);
  if (!note.content.trim()) throw new NoteError("The note is empty, so there's nothing to summarize.");
  const summary = await chatComplete({
    operation: "note-summary",
    maxTokens: 600,
    system:
      "You summarize a person's working note. Reply with markdown only: 3 to 6 short bullet points covering the decisions, facts and open questions. No heading, no preamble, and nothing that isn't in the note.",
    user: forModel(note),
  });
  return summary.trim();
}

export type SuggestedTask = { title: string; priority: "low" | "medium" | "high"; dueDate: string | null };

/** Pull the action items out of a note, for the person to pick from. Nothing is created here. */
export async function suggestTasks(id: string, me: string): Promise<SuggestedTask[]> {
  const note = await visibleNote(id, me);
  if (!note.content.trim()) throw new NoteError("The note is empty, so there are no action items in it.");
  const today = new Date().toISOString().slice(0, 10);
  const reply = await chatComplete({
    operation: "note-tasks",
    maxTokens: 1200,
    system: `You find the action items in a person's working note: things someone still has to do. Skip anything already done (a checked [x] item, or something written as finished). Today is ${today}; turn relative dates ("by Friday") into YYYY-MM-DD, and use null when the note gives no date. Priority is "high" only when the note says it's urgent or blocking, "low" when it's optional, otherwise "medium". Reply with JSON only, no code fence: {"tasks":[{"title":"short imperative task","priority":"medium","dueDate":null}]}. At most 15 tasks; an empty list when there are none.`,
    user: forModel(note),
  });
  return parseSuggestedTasks(reply);
}

/** The model's JSON, read leniently: a code fence or stray prose around it is fine. */
export function parseSuggestedTasks(reply: string): SuggestedTask[] {
  const json = reply.slice(reply.indexOf("{"), reply.lastIndexOf("}") + 1);
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new NoteError("The AI didn't return a task list. Try again.", 409);
  }
  const list = (data as { tasks?: unknown }).tasks;
  if (!Array.isArray(list)) return [];
  return list
    .map((t) => t as Record<string, unknown>)
    .filter((t) => typeof t.title === "string" && t.title.trim())
    .slice(0, 15)
    .map((t) => ({
      title: (t.title as string).trim().slice(0, 300),
      priority: t.priority === "high" || t.priority === "low" ? t.priority : "medium",
      dueDate: typeof t.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(t.dueDate) ? t.dueDate : null,
    }));
}

/** Create the tasks the person picked, on the note's project when it has one, assigned to them. */
export async function createTasksFromNote(id: string, input: unknown, me: string, assignee: string | null) {
  const note = await visibleNote(id, me);
  const list = Array.isArray(input) ? input : [];
  if (list.length === 0) throw new NoteError("Pick at least one task.");
  if (list.length > 30) throw new NoteError("At most 30 tasks at a time.");
  const from = `From the note "${note.title.trim() || "Untitled note"}" (/notes?id=${note.id})`;
  const inputs = list.map((raw) => {
    const t = (raw ?? {}) as Record<string, unknown>;
    return { title: t.title, priority: t.priority, dueDate: t.dueDate ?? undefined, projectId: note.projectId ?? undefined, assignee: assignee ?? undefined, notes: from };
  });
  // Check them all first, so a bad one doesn't leave half the list created.
  inputs.forEach(parseNewTask);
  const created = [];
  for (const input of inputs) created.push(await createTask(input, me));
  return created;
}
