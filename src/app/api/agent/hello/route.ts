import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { agentFromRequest, unauthorized, type AgentRepo } from "@/lib/releases";

/** Sent when the agent starts: what it can do and which repos it serves. */
export async function POST(req: NextRequest) {
  const agent = await agentFromRequest(req);
  if (!agent) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  await prisma.releaseAgent.update({
    where: { id: agent.id },
    data: {
      ...(Array.isArray(body.capabilities) ? { capabilities: JSON.stringify(body.capabilities.map(String)) } : {}),
      ...(Array.isArray(body.repos) ? { repos: JSON.stringify(body.repos as AgentRepo[]) } : {}),
      ...(typeof body.version === "string" ? { version: body.version } : {}),
    },
  });
  return Response.json({ ok: true, agentId: agent.id, name: agent.name });
}
