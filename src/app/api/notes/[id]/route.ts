import { NextRequest } from "next/server";
import { LOCAL_OWNER, deleteNote, getNote, noteErrorResponse, updateNote } from "@/lib/notes";
import { currentUserEmail } from "@/lib/users";

type Ctx = { params: Promise<{ id: string }> };

const me = async () => (await currentUserEmail()) ?? LOCAL_OWNER;

/** A note, with the notes it links to ([[Title]]) and the ones linking to it. */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  try {
    return Response.json(await getNote(id, await me()));
  } catch (err) {
    return noteErrorResponse(err);
  }
}

/**
 * Update a note. body: { title?, content?, tags?, pinned?, folderId?, projectId?,
 * shared?, archived?, trashed?, expectedUpdatedAt? }. With expectedUpdatedAt,
 * a save over someone else's newer edit is a 409 instead of an overwrite.
 */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    return Response.json({ note: await updateNote(id, body, await me()) });
  } catch (err) {
    return noteErrorResponse(err);
  }
}

/** Delete a note for good. It must be in the trash. */
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  try {
    await deleteNote(id, await me());
    return Response.json({ ok: true });
  } catch (err) {
    return noteErrorResponse(err);
  }
}
