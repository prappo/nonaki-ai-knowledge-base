import { NextRequest } from "next/server";
import { agentFromRequest, unauthorized } from "@/lib/releases";
import { tunnel } from "@/lib/releaseTunnel";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * The agent's long poll: tunnelled console requests (and cancellations) for
 * it, returned as soon as there are any, or after ?wait= seconds (max 25).
 */
export async function GET(req: NextRequest) {
  const agent = await agentFromRequest(req);
  if (!agent) return unauthorized();
  const wait = Math.min(25, Math.max(0, Number(req.nextUrl.searchParams.get("wait")) || 0));
  await tunnel.waitForWork(agent.id, wait * 1000, req.signal);
  return Response.json(tunnel.take(agent.id));
}
