import { prisma } from "./prisma";
import { indexDocument, deindexDocument, log } from "./indexer";
import { snapshotVersion } from "./versions";
import { audit } from "./audit";

export type ResolveResult =
  | { ok: true; status: "approved" | "rejected"; version?: number; chunks?: number; archived?: boolean }
  | { ok: false; error: string; code: number };

/**
 * Approve or reject a single proposal. Shared by the single-proposal route and
 * bulk "approve all from source".
 *
 * Approving an UPDATE snapshots the current content as a version, publishes the
 * new content and re-indexes in Weaviate. Approving an ARCHIVE de-indexes the
 * document (restorable). `newContent` allows last-minute edits from the review
 * screen.
 */
export async function resolveProposal(
  proposalId: string,
  action: "approve" | "reject",
  opts: { newContent?: string; actor?: string } = {}
): Promise<ResolveResult> {
  const proposal = await prisma.proposal.findUnique({
    where: { id: proposalId },
    include: { document: true },
  });
  if (!proposal) return { ok: false, error: "Proposal not found", code: 404 };
  if (proposal.status !== "pending") {
    return { ok: false, error: `Proposal already ${proposal.status}`, code: 409 };
  }

  if (action === "reject") {
    await prisma.proposal.update({
      where: { id: proposalId },
      data: { status: "rejected", resolvedAt: new Date() },
    });
    await log(
      `Proposal rejected — "${proposal.document.title}" stays at v${proposal.document.version}`
    );
    await audit("proposal.rejected", `Rejected ${proposal.type} proposal for "${proposal.document.title}"`, {
      entityType: "proposal",
      entityId: proposalId,
      actor: opts.actor,
      detail: { documentId: proposal.documentId, origin: proposal.origin },
    });
    return { ok: true, status: "rejected" };
  }

  if (proposal.type === "archive") {
    await deindexDocument(proposal.documentId);
    await prisma.document.update({
      where: { id: proposal.documentId },
      data: { status: "archived", archivedAt: new Date(), chunkCount: 0 },
    });
    await prisma.proposal.update({
      where: { id: proposalId },
      data: { status: "approved", resolvedAt: new Date() },
    });
    await log(`"${proposal.document.title}" archived — removed from the Weaviate index`);
    await audit("proposal.approved", `Approved archive of "${proposal.document.title}"`, {
      entityType: "proposal",
      entityId: proposalId,
      actor: opts.actor,
      detail: { documentId: proposal.documentId, type: "archive", origin: proposal.origin },
    });
    return { ok: true, status: "approved", archived: true };
  }

  // UPDATE: allow last-minute edits from the review screen
  const finalContent = opts.newContent?.trim() || proposal.newContent;
  await snapshotVersion(proposal.document, "proposal");
  const updated = await prisma.document.update({
    where: { id: proposal.documentId },
    data: {
      content: finalContent,
      title: proposal.newTitle ?? proposal.document.title,
      excerpt: finalContent.slice(0, 300),
      version: { increment: 1 },
      verified: true,
      status: "indexed",
      archivedAt: null,
    },
  });
  const chunks = await indexDocument(updated.id);
  await prisma.proposal.update({
    where: { id: proposalId },
    data: { status: "approved", newContent: finalContent, resolvedAt: new Date() },
  });
  await log(
    `Proposal approved — "${updated.title}" published as v${updated.version}, re-chunked into ${chunks} and re-indexed in Weaviate`
  );
  await audit("proposal.approved", `Approved update to "${updated.title}" → v${updated.version}`, {
    entityType: "proposal",
    entityId: proposalId,
    actor: opts.actor,
    detail: {
      documentId: proposal.documentId,
      version: updated.version,
      chunks,
      origin: proposal.origin,
      edited: Boolean(opts.newContent?.trim()),
    },
  });

  return { ok: true, status: "approved", version: updated.version, chunks };
}
