import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { hashToken, newAgentToken, type AgentRepo } from "@/lib/releases";

/**
 * Exchange a one-time pairing code (from the Releases page) for an agent token.
 * body: { code, name, capabilities?, repos?, version? }
 * The token is returned once; only its hash is stored.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 100) : "Laptop";
  if (!code) return Response.json({ error: "code is required" }, { status: 400 });

  // single use: claim the code atomically
  const claimed = await prisma.releasePairing.updateMany({
    where: { code, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });
  if (claimed.count !== 1) {
    return Response.json({ error: "That pairing code is invalid, used or expired. Make a new one on the Releases page." }, { status: 400 });
  }
  const pairing = await prisma.releasePairing.findUnique({ where: { code } });

  const token = newAgentToken();
  const agent = await prisma.releaseAgent.create({
    data: {
      name,
      tokenHash: hashToken(token),
      capabilities: JSON.stringify(Array.isArray(body.capabilities) ? body.capabilities.map(String) : []),
      repos: JSON.stringify(Array.isArray(body.repos) ? (body.repos as AgentRepo[]) : []),
      version: typeof body.version === "string" ? body.version : null,
      lastSeenAt: new Date(),
    },
  });
  await audit("release.agent_paired", `Release agent paired: ${name}`, {
    entityType: "releaseAgent",
    entityId: agent.id,
    actor: pairing?.createdBy ?? "system",
  });
  return Response.json({ agentId: agent.id, token }, { status: 201 });
}
