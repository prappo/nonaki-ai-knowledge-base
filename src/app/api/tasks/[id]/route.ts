import { NextRequest } from "next/server";
import { deleteTask, projectErrorResponse, updateTask } from "@/lib/projectStore";

type Ctx = { params: Promise<{ id: string }> };

/** Update a task. body: { title?, notes?, status?, priority?, dueDate?, assignee?, projectId? } */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    return Response.json({ task: await updateTask(id, body) });
  } catch (err) {
    return projectErrorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  try {
    await deleteTask(id);
    return Response.json({ ok: true });
  } catch (err) {
    return projectErrorResponse(err);
  }
}
