import { NextRequest } from "next/server";
import {
  deleteProject,
  getProject,
  projectErrorResponse,
  updateProject,
} from "@/lib/projectStore";

type Ctx = { params: Promise<{ id: string }> };

/** Full project: tasks (board order) + linked documents. */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  try {
    return Response.json({ project: await getProject(id) });
  } catch (err) {
    return projectErrorResponse(err);
  }
}

/** Update name / description / status / dueDate. */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    return Response.json({ project: await updateProject(id, body) });
  } catch (err) {
    return projectErrorResponse(err);
  }
}

/** Delete a project with its tasks (linked documents are untouched). */
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  try {
    await deleteProject(id);
    return Response.json({ ok: true });
  } catch (err) {
    return projectErrorResponse(err);
  }
}
