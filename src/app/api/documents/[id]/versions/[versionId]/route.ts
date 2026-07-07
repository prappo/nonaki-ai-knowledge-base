import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { indexDocument, log } from "@/lib/indexer";
import { snapshotVersion } from "@/lib/versions";
import { audit } from "@/lib/audit";

/** Full content of one archived version (for diffing against the current doc). */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; versionId: string }> }
) {
  const { id, versionId } = await params;
  const version = await prisma.documentVersion.findUnique({ where: { id: versionId } });
  if (!version || version.documentId !== id) {
    return Response.json({ error: "Version not found" }, { status: 404 });
  }
  return Response.json({ version });
}

/**
 * Roll a document back to this version.
 * body: { action: "restore" }
 * The current content is snapshotted first, then the old title/content is
 * published as a NEW version (so a rollback is itself in the history) and
 * re-indexed in Weaviate.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> }
) {
  const { id, versionId } = await params;
  const { action } = (await req.json().catch(() => ({}))) as { action?: string };
  if (action !== "restore") {
    return Response.json({ error: "action must be 'restore'" }, { status: 400 });
  }

  const [doc, version] = await Promise.all([
    prisma.document.findUnique({ where: { id } }),
    prisma.documentVersion.findUnique({ where: { id: versionId } }),
  ]);
  if (!doc) return Response.json({ error: "Document not found" }, { status: 404 });
  if (!version || version.documentId !== id) {
    return Response.json({ error: "Version not found" }, { status: 404 });
  }

  await snapshotVersion(doc, "restore");
  const updated = await prisma.document.update({
    where: { id },
    data: {
      title: version.title,
      content: version.content,
      excerpt: version.content.slice(0, 300),
      version: { increment: 1 },
      status: "indexed",
      archivedAt: null,
    },
  });

  try {
    const chunks = await indexDocument(id);
    await log(
      `"${updated.title}" rolled back to v${version.version} — published as v${updated.version} and re-indexed`
    );
    await audit(
      "document.rolled_back",
      `Rolled back "${updated.title}" to v${version.version} (now v${updated.version})`,
      {
        entityType: "document",
        entityId: id,
        detail: { restoredVersion: version.version, newVersion: updated.version, chunks },
      }
    );
    return Response.json({ ok: true, document: updated, chunks });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Re-index failed" },
      { status: 502 }
    );
  }
}
