import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";

/** Unpair (revoke) an agent: its token stops working immediately. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agent = await prisma.releaseAgent.findUnique({ where: { id } });
  if (!agent) return Response.json({ error: "Agent not found" }, { status: 404 });
  await prisma.releaseAgent.delete({ where: { id } });
  await audit("release.agent_removed", `Release agent removed: ${agent.name}`, { entityType: "releaseAgent", entityId: id });
  return Response.json({ ok: true });
}
