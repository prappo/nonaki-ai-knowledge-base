import { NextRequest } from "next/server";
import { LOCAL_OWNER, createNote, listNotes, noteErrorResponse, notebookSummary } from "@/lib/notes";
import { currentUserEmail } from "@/lib/users";

/**
 * The signed-in user's notes, plus the ones others shared.
 * ?view=all|pinned|shared|archive|trash &folder=<id>|none &tag= &project=<id>|none
 * &q= &sort=updated|created|title
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const me = (await currentUserEmail()) ?? LOCAL_OWNER;
  const list = await listNotes(
    { view: p.get("view"), folder: p.get("folder"), tag: p.get("tag"), project: p.get("project"), q: p.get("q"), sort: p.get("sort") },
    me
  );
  return Response.json({ ...list, ...(await notebookSummary(me)), me });
}

/** Create a note. body: { title?, content?, tags?, pinned?, folderId?, projectId? } */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const note = await createNote(body, (await currentUserEmail()) ?? LOCAL_OWNER);
    return Response.json({ note }, { status: 201 });
  } catch (err) {
    return noteErrorResponse(err);
  }
}
