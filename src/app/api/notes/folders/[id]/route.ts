import { NextRequest } from "next/server";
import { LOCAL_OWNER, deleteFolder, noteErrorResponse, renameFolder } from "@/lib/notes";
import { currentUserEmail } from "@/lib/users";

type Ctx = { params: Promise<{ id: string }> };

/** Rename a folder. body: { name } */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    return Response.json({ folder: await renameFolder(id, body, (await currentUserEmail()) ?? LOCAL_OWNER) });
  } catch (err) {
    return noteErrorResponse(err);
  }
}

/** Delete a folder; its notes move out of it. */
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  try {
    await deleteFolder(id, (await currentUserEmail()) ?? LOCAL_OWNER);
    return Response.json({ ok: true });
  } catch (err) {
    return noteErrorResponse(err);
  }
}
