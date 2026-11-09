import { NextRequest } from "next/server";
import { LOCAL_OWNER, noteErrorResponse } from "@/lib/notes";
import { suggestTasks, summarizeNote } from "@/lib/noteTools";
import { currentUserEmail } from "@/lib/users";

export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

/** body: { action: "summarize" } → { summary } · { action: "tasks" } → { tasks } (suggestions only) */
export async function POST(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const { action } = (await req.json().catch(() => ({}))) as { action?: unknown };
  const me = (await currentUserEmail()) ?? LOCAL_OWNER;
  try {
    if (action === "summarize") return Response.json({ summary: await summarizeNote(id, me) });
    if (action === "tasks") return Response.json({ tasks: await suggestTasks(id, me) });
    return Response.json({ error: 'Unknown action: use "summarize" or "tasks"' }, { status: 400 });
  } catch (err) {
    if (err instanceof Error && !("status" in err)) {
      return Response.json({ error: `The AI request failed: ${err.message}` }, { status: 502 });
    }
    return noteErrorResponse(err);
  }
}
