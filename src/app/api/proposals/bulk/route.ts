import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveProposal } from "@/lib/proposals";
import { currentActor } from "@/lib/audit";

export const maxDuration = 300;

/**
 * Resolve many proposals at once.
 * body: { action: "approve" | "reject" } plus ONE of:
 *   ids: string[]        — explicit proposals
 *   sourceId: string     — every pending proposal for documents of this source
 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    action?: string;
    ids?: string[];
    sourceId?: string;
  };
  if (body.action !== "approve" && body.action !== "reject") {
    return Response.json({ error: "action must be 'approve' or 'reject'" }, { status: 400 });
  }

  let ids = [...new Set(body.ids ?? [])].filter(Boolean);
  if (ids.length === 0 && body.sourceId) {
    const pending = await prisma.proposal.findMany({
      where: { status: "pending", document: { sourceId: body.sourceId } },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    ids = pending.map((p) => p.id);
  }
  if (ids.length === 0) {
    return Response.json({ error: "Nothing to resolve" }, { status: 400 });
  }
  if (ids.length > 200) {
    return Response.json({ error: "Max 200 proposals per request" }, { status: 400 });
  }

  // Approving re-indexes each doc in Weaviate — resolve the actor once up front,
  // then process sequentially to keep embedding-service load sane.
  const actor = await currentActor();
  let resolved = 0;
  const errors: { id: string; error: string }[] = [];
  for (const id of ids) {
    try {
      const result = await resolveProposal(id, body.action, { actor });
      if (result.ok) resolved++;
      else errors.push({ id, error: result.error });
    } catch (err) {
      errors.push({ id, error: err instanceof Error ? err.message : "Failed" });
    }
  }

  return Response.json({ resolved, errors });
}
