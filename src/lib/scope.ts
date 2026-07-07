import { prisma } from "./prisma";

/**
 * Resolve a source-scope selection to a documentId filter for Weaviate.
 * Returns undefined when the scope covers everything (no filter needed).
 */
export async function docIdsForSources(
  sourceIds?: string[]
): Promise<string[] | undefined> {
  if (!sourceIds || sourceIds.length === 0) return undefined;

  const totalSources = await prisma.source.count();
  if (sourceIds.length >= totalSources) return undefined; // all sources → no filter

  const docs = await prisma.document.findMany({
    where: { sourceId: { in: sourceIds }, status: "indexed" },
    select: { id: true },
  });
  return docs.map((d) => d.id);
}
