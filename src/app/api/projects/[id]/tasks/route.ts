import { NextRequest } from "next/server";
import { addTasks, projectErrorResponse } from "@/lib/projectStore";

/** Add a task to the end of a column. body: { title, status?, priority?, dueDate?, notes? } */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const [task] = await addTasks(id, [body]);
    return Response.json({ task }, { status: 201 });
  } catch (err) {
    return projectErrorResponse(err);
  }
}
