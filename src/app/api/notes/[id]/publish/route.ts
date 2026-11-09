import { NextRequest } from "next/server";
import { LOCAL_OWNER, noteErrorResponse } from "@/lib/notes";
import { publishNote, unpublishNote } from "@/lib/noteTools";
import { currentUserEmail } from "@/lib/users";

export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

/** Add the note to the knowledge base, or refresh its copy there. */
export async function POST(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  try {
    return Response.json(await publishNote(id, (await currentUserEmail()) ?? LOCAL_OWNER));
  } catch (err) {
    return noteErrorResponse(err);
  }
}

/** Remove the note's copy from the knowledge base. */
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  try {
    await unpublishNote(id, (await currentUserEmail()) ?? LOCAL_OWNER);
    return Response.json({ ok: true });
  } catch (err) {
    return noteErrorResponse(err);
  }
}
