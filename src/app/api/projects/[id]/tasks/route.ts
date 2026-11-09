import { NextRequest } from "next/server";
import { addTasks, projectErrorResponse } from "@/lib/projectStore";
import { currentUserEmail } from "@/lib/users";

/** Add a task to the end of a column. body: { title, status?, priority?, dueDate?, notes?, assignee? } */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const [task] = await addTasks(id, [body], (await currentUserEmail()) ?? "system");
    return Response.json({ task }, { status: 201 });
  } catch (err) {
    return projectErrorResponse(err);
  }
}
