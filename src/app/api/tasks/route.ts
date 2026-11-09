import { NextRequest } from "next/server";
import { createTask, listTasks, projectErrorResponse, taskCounts } from "@/lib/projectStore";
import { currentUserEmail } from "@/lib/users";

/**
 * Tasks across every project, plus standalone ones.
 * ?assignee=me|unassigned|<email> &status=open|todo|doing|done|all
 * &project=<id>|none &priority=low|medium|high &due=overdue|today|week|none &q=
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const me = await currentUserEmail();
  const [{ tasks, truncated }, counts] = await Promise.all([
    listTasks(
      {
        assignee: p.get("assignee"),
        status: p.get("status"),
        project: p.get("project"),
        priority: p.get("priority"),
        due: p.get("due"),
        q: p.get("q"),
      },
      me
    ),
    taskCounts(me),
  ]);
  return Response.json({ tasks, truncated, counts, me });
}

/** Create a task. body: { title, projectId?, assignee?, status?, priority?, dueDate?, notes? } */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const task = await createTask(body, (await currentUserEmail()) ?? "system");
    return Response.json({ task }, { status: 201 });
  } catch (err) {
    return projectErrorResponse(err);
  }
}
