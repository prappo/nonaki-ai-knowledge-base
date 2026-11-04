import { NextRequest } from "next/server";
import { createProject, listProjects, projectErrorResponse } from "@/lib/projectStore";

/** List projects with task progress. ?status= filters by project status. */
export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status") ?? undefined;
  return Response.json({ projects: await listProjects(status) });
}

/** Create a project. body: { name, description?, status?, dueDate? } */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const project = await createProject(body);
    return Response.json({ project }, { status: 201 });
  } catch (err) {
    return projectErrorResponse(err);
  }
}
