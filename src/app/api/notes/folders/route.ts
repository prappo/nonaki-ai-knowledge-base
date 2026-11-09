import { NextRequest } from "next/server";
import { LOCAL_OWNER, createFolder, noteErrorResponse } from "@/lib/notes";
import { currentUserEmail } from "@/lib/users";

/** Create a folder. body: { name } */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    return Response.json({ folder: await createFolder(body, (await currentUserEmail()) ?? LOCAL_OWNER) }, { status: 201 });
  } catch (err) {
    return noteErrorResponse(err);
  }
}
