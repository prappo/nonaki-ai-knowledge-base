import { NextRequest } from "next/server";
import { LOCAL_OWNER, listVersions, noteErrorResponse } from "@/lib/notes";
import { currentUserEmail } from "@/lib/users";

type Ctx = { params: Promise<{ id: string }> };

/** The note's earlier versions, newest first (without their text). */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  try {
    return Response.json(await listVersions(id, (await currentUserEmail()) ?? LOCAL_OWNER));
  } catch (err) {
    return noteErrorResponse(err);
  }
}
