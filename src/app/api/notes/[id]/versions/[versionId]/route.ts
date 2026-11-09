import { NextRequest } from "next/server";
import { LOCAL_OWNER, getVersion, noteErrorResponse, restoreVersion } from "@/lib/notes";
import { currentUserEmail } from "@/lib/users";

type Ctx = { params: Promise<{ id: string; versionId: string }> };

/** One earlier version, with its text. */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id, versionId } = await params;
  try {
    return Response.json({ version: await getVersion(id, versionId, (await currentUserEmail()) ?? LOCAL_OWNER) });
  } catch (err) {
    return noteErrorResponse(err);
  }
}

/** Restore this version. body: { action: "restore" } */
export async function POST(req: NextRequest, { params }: Ctx) {
  const { id, versionId } = await params;
  const { action } = (await req.json().catch(() => ({}))) as { action?: unknown };
  if (action !== "restore") return Response.json({ error: 'Unknown action: use "restore"' }, { status: 400 });
  try {
    return Response.json({ note: await restoreVersion(id, versionId, (await currentUserEmail()) ?? LOCAL_OWNER) });
  } catch (err) {
    return noteErrorResponse(err);
  }
}
