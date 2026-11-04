import { prisma } from "@/lib/prisma";
import { agentView } from "@/lib/releases";

/** Paired agents, newest first. */
export async function GET() {
  const agents = await prisma.releaseAgent.findMany({ orderBy: { createdAt: "desc" } });
  return Response.json({ agents: agents.map(agentView) });
}
