import { prisma } from "@/lib/prisma";
import { indexDocument, log } from "@/lib/indexer";
import { audit } from "@/lib/audit";

/** Restore an archived document — re-chunks and re-indexes it in Weaviate. */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const doc = await prisma.document.findUnique({ where: { id } });
  if (!doc) return Response.json({ error: "Not found" }, { status: 404 });
  if (doc.status !== "archived") {
    return Response.json({ error: "Document is not archived" }, { status: 409 });
  }

  try {
    const chunks = await indexDocument(id); // also flips status back to "indexed"
    await prisma.document.update({ where: { id }, data: { archivedAt: null } });
    await log(`"${doc.title}" restored from archive — re-indexed into ${chunks} chunks`);
    await audit("document.restored", `Restored "${doc.title}" from archive`, {
      entityType: "document",
      entityId: id,
      detail: { chunks },
    });
    return Response.json({ ok: true, chunks });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Re-index failed" },
      { status: 502 }
    );
  }
}
