import { NextRequest } from "next/server";
import { agentFromRequest, unauthorized } from "@/lib/releases";
import { tunnel } from "@/lib/releaseTunnel";

export const dynamic = "force-dynamic";

/** Response parts from the agent for tunnelled requests: head, body chunks, end or error. */
export async function POST(req: NextRequest) {
  const agent = await agentFromRequest(req);
  if (!agent) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as { parts?: Parameters<typeof tunnel.receive>[1][] };
  for (const part of Array.isArray(body.parts) ? body.parts.slice(0, 1000) : []) {
    if (part && typeof part.id === "string") tunnel.receive(agent.id, part);
  }
  return Response.json({ ok: true });
}
