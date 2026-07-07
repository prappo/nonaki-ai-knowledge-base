import { NextRequest } from "next/server";
import { resolveProposal } from "@/lib/proposals";

/**
 * Resolve a proposal.
 * body: { action: "approve" | "reject", newContent?: string }
 *
 * Approving an UPDATE proposal snapshots the previous content as a version,
 * writes the new content to the document and re-chunks + re-indexes it in
 * Weaviate. Approving an ARCHIVE proposal removes the document's chunks from
 * Weaviate (restorable from the Documents screen).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await req.json()) as { action?: string; newContent?: string };

  if (body.action !== "approve" && body.action !== "reject") {
    return Response.json({ error: "action must be 'approve' or 'reject'" }, { status: 400 });
  }

  const result = await resolveProposal(id, body.action, { newContent: body.newContent });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.code });
  return Response.json(result);
}
