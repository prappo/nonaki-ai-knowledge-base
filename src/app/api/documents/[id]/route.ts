import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { indexDocument, deindexDocument, log } from "@/lib/indexer";
import { snapshotVersion } from "@/lib/versions";
import { audit } from "@/lib/audit";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const document = await prisma.document.findUnique({
    where: { id },
    include: {
      source: { select: { name: true, type: true } },
      proposals: { where: { status: "pending" }, orderBy: { createdAt: "desc" } },
      _count: { select: { versions: true } },
    },
  });
  if (!document) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ document });
}

/**
 * Edit a document directly. The previous content is snapshotted as a version,
 * then the new content is immediately re-chunked and re-indexed in Weaviate
 * (auto-sync — no approval step for manual edits).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await req.json()) as { title?: string; content?: string };

  const doc = await prisma.document.findUnique({ where: { id } });
  if (!doc) return Response.json({ error: "Not found" }, { status: 404 });

  const title = body.title?.trim() || doc.title;
  const content = body.content?.trim() ?? doc.content;
  if (!content) {
    return Response.json({ error: "Content cannot be empty" }, { status: 400 });
  }
  const changed = title !== doc.title || content !== doc.content;
  if (!changed) return Response.json({ document: doc, chunks: doc.chunkCount });

  await snapshotVersion(doc, "edit");
  const updated = await prisma.document.update({
    where: { id },
    data: {
      title,
      content,
      excerpt: content.slice(0, 300),
      version: { increment: 1 },
      status: "indexed",
      archivedAt: null,
    },
  });

  try {
    const chunks = await indexDocument(id);
    await log(
      `"${updated.title}" edited — v${updated.version} re-chunked into ${chunks} and re-indexed in Weaviate`
    );
    await audit("document.edited", `Edited "${updated.title}" (v${doc.version} → v${updated.version})`, {
      entityType: "document",
      entityId: id,
      detail: { fromVersion: doc.version, toVersion: updated.version, chunks },
    });
    return Response.json({ document: updated, chunks });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Re-index failed" },
      { status: 502 }
    );
  }
}

/**
 * Delete a document. By default this is a SAFE delete: chunks are removed from
 * Weaviate but the record is kept as `archived`, so it can be restored.
 * Pass ?permanent=1 to remove the record (and its version history) for good.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const permanent = req.nextUrl.searchParams.get("permanent") === "1";
  const doc = await prisma.document.findUnique({ where: { id } });
  if (!doc) return Response.json({ error: "Not found" }, { status: 404 });

  try {
    await deindexDocument(id);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to remove chunks from Weaviate" },
      { status: 502 }
    );
  }

  if (permanent) {
    await prisma.document.delete({ where: { id } });
    await log(`"${doc.title}" permanently deleted — removed from the Weaviate index`);
    await audit("document.deleted", `Permanently deleted "${doc.title}"`, {
      entityType: "document",
      entityId: id,
      detail: { sourceId: doc.sourceId, kind: doc.kind, version: doc.version },
    });
    return Response.json({ ok: true, permanent: true });
  }

  await prisma.document.update({
    where: { id },
    data: { status: "archived", archivedAt: new Date(), chunkCount: 0 },
  });
  await log(`"${doc.title}" archived — removed from the Weaviate index (restorable)`);
  await audit("document.archived", `Archived "${doc.title}"`, {
    entityType: "document",
    entityId: id,
  });
  return Response.json({ ok: true, archived: true });
}
