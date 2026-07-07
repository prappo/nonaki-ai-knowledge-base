import { prisma } from "./prisma";
import { chunkText } from "./chunker";
import { getChunkCollection } from "./weaviate";
import { getNumberSetting } from "./settings";

/**
 * Chunk a document's content with LangChain and (re)index it in Weaviate.
 * Existing chunks for the document are removed first.
 */
export async function indexDocument(documentId: string): Promise<number> {
  const doc = await prisma.document.findUniqueOrThrow({
    where: { id: documentId },
    include: { source: true },
  });

  const collection = await getChunkCollection();

  // Remove any stale chunks for this document
  await collection.data.deleteMany(
    collection.filter.byProperty("documentId").equal(documentId)
  );

  const chunkSize = await getNumberSetting("chunkSize");
  const chunks = await chunkText(doc.content, { chunkSize });
  if (chunks.length > 0) {
    const objects = chunks.map((content, i) => ({
      content,
      title: doc.title,
      documentId,
      sourceType: doc.source.type,
      url: doc.url ?? "",
      chunkIndex: i,
    }));
    // Insert in batches — very large docs can exceed the embedding
    // service's per-request limits otherwise.
    const BATCH = 64;
    for (let start = 0; start < objects.length; start += BATCH) {
      const result = await collection.data.insertMany(
        objects.slice(start, start + BATCH)
      );
      if (result.hasErrors) {
        const firstError = Object.values(result.errors)[0]?.message;
        throw new Error(`Weaviate insert failed: ${firstError}`);
      }
    }
  }

  await prisma.document.update({
    where: { id: documentId },
    data: { chunkCount: chunks.length, status: "indexed" },
  });

  return chunks.length;
}

/** Remove a document's chunks from Weaviate (archive / delete). */
export async function deindexDocument(documentId: string): Promise<void> {
  const collection = await getChunkCollection();
  await collection.data.deleteMany(
    collection.filter.byProperty("documentId").equal(documentId)
  );
}

/** Bulk-remove many documents' chunks in a few Weaviate calls (source disconnect). */
export async function deindexDocuments(documentIds: string[]): Promise<void> {
  if (documentIds.length === 0) return;
  const collection = await getChunkCollection();
  const BATCH = 100; // keep the containsAny filter payload bounded
  for (let start = 0; start < documentIds.length; start += BATCH) {
    await collection.data.deleteMany(
      collection.filter
        .byProperty("documentId")
        .containsAny(documentIds.slice(start, start + BATCH))
    );
  }
}

export async function log(
  message: string,
  opts: { sourceId?: string; level?: string } = {}
) {
  await prisma.syncLog.create({
    data: { message, sourceId: opts.sourceId, level: opts.level ?? "info" },
  });
}
