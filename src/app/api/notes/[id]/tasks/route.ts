import { NextRequest } from "next/server";
import { LOCAL_OWNER, NoteError, noteErrorResponse } from "@/lib/notes";
import { createTasksFromNote } from "@/lib/noteTools";
import { projectErrorResponse } from "@/lib/projectStore";
import { currentUserEmail } from "@/lib/users";

type Ctx = { params: Promise<{ id: string }> };

/** Create tasks from a note's action items. body: { tasks: [{ title, priority?, dueDate? }] } */
export async function POST(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { tasks?: unknown };
  const email = await currentUserEmail();
  try {
    const tasks = await createTasksFromNote(id, body.tasks, email ?? LOCAL_OWNER, email);
    return Response.json({ tasks }, { status: 201 });
  } catch (err) {
    return err instanceof NoteError ? noteErrorResponse(err) : projectErrorResponse(err);
  }
}
