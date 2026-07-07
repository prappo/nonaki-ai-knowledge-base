import { getChunkCollection } from "./weaviate";

export type RetrievedChunk = {
  content: string;
  title: string;
  documentId: string;
  sourceType: string;
  url: string;
  chunkIndex: number;
  score: number;
};

export type RetrievalMode = "hybrid" | "semantic" | "keyword";

// Weaviate hybrid alpha: 1 = pure vector similarity, 0 = pure BM25 keywords
const MODE_ALPHA: Record<RetrievalMode, number> = {
  hybrid: 0.6,
  semantic: 1,
  keyword: 0,
};

export function toRetrievalMode(value: unknown): RetrievalMode {
  return value === "semantic" || value === "keyword" ? value : "hybrid";
}

/**
 * Retrieval from Weaviate — hybrid (vector + BM25) by default, or pure
 * semantic / keyword via `mode`.
 * Pass `docIds` to scope retrieval to specific documents (source filtering).
 */
export async function retrieve(
  query: string,
  limit = 8,
  docIds?: string[],
  mode: RetrievalMode = "hybrid"
): Promise<RetrievedChunk[]> {
  if (docIds && docIds.length === 0) return [];
  const collection = await getChunkCollection();
  const result = await collection.query.hybrid(query, {
    limit,
    alpha: MODE_ALPHA[mode],
    returnMetadata: ["score"],
    ...(docIds
      ? { filters: collection.filter.byProperty("documentId").containsAny(docIds) }
      : {}),
  });

  return result.objects.map((o) => ({
    content: o.properties.content,
    title: o.properties.title,
    documentId: o.properties.documentId,
    sourceType: o.properties.sourceType,
    url: o.properties.url,
    chunkIndex: o.properties.chunkIndex,
    score: o.metadata?.score ?? 0,
  }));
}

export type Citation = {
  n: number;
  documentId: string;
  title: string;
  sourceType: string;
  url: string;
  /** The best-scoring chunk actually fed to the model, for preview. */
  snippet: string;
  chunkIndex: number;
  /** How many of this doc's chunks were used in the context. */
  chunksUsed: number;
};

const SNIPPET_MAX = 420;

/**
 * Collapse whitespace noise before content goes into a prompt. HTML-derived
 * documents (WordPress imports especially) are riddled with tab/newline runs
 * that burn tokens without carrying meaning. Paragraph breaks survive.
 */
export function normalizeForPrompt(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n") // trailing whitespace per line
    .replace(/[ \t]{2,}/g, " ") // runs of spaces/tabs
    .replace(/\n{3,}/g, "\n\n") // vertical gaps
    .trim();
}

// Keep at least this many chunks regardless of score, so a weakly-matched
// but correct chunk is never starved out of the context.
const MIN_KEEP = 3;
// Drop tail chunks scoring below this fraction of the best chunk. When the
// scores are flat (uncertain retrieval) nothing is dropped; when there's a
// clear cliff after the top matches, the noise below it is trimmed.
const REL_SCORE_CUTOFF = 0.5;

/** Trim the retrieval tail: exact duplicates + clearly-irrelevant chunks. */
function selectChunks(chunks: RetrievedChunk[]): RetrievedChunk[] {
  const seen = new Set<string>();
  const unique = chunks.filter((c) => {
    const key = `${c.documentId}:${c.content}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const top = unique[0]?.score ?? 0;
  return unique.filter((c, i) => i < MIN_KEEP || c.score >= top * REL_SCORE_CUTOFF);
}

/**
 * Dedupe retrieved chunks by document into numbered citations, and build the
 * per-source context blocks fed to the model. Chunks from the same document
 * are grouped under one <source> header so titles aren't repeated, contents
 * are whitespace-normalized, and the low-relevance tail is trimmed.
 */
export function buildCitations(chunks: RetrievedChunk[]): {
  citations: Citation[];
  contextBlocks: string[];
} {
  const kept = selectChunks(chunks);
  const citations: Citation[] = [];
  const byDoc = new Map<string, Citation>();
  const contentsByDoc = new Map<string, string[]>();

  for (const chunk of kept) {
    const content = normalizeForPrompt(chunk.content);
    let citation = byDoc.get(chunk.documentId);
    if (!citation) {
      citation = {
        n: citations.length + 1,
        documentId: chunk.documentId,
        title: chunk.title,
        sourceType: chunk.sourceType,
        url: chunk.url,
        // chunks arrive ranked by score, so the first one per doc is its best
        snippet:
          content.length > SNIPPET_MAX
            ? `${content.slice(0, SNIPPET_MAX).trimEnd()}…`
            : content,
        chunkIndex: chunk.chunkIndex,
        chunksUsed: 0,
      };
      byDoc.set(chunk.documentId, citation);
      contentsByDoc.set(chunk.documentId, []);
      citations.push(citation);
    }
    citation.chunksUsed++;
    contentsByDoc.get(chunk.documentId)!.push(content);
  }

  const contextBlocks = citations.map((c) => {
    // "[…]" marks a gap between non-adjacent passages of the same document
    const body = contentsByDoc.get(c.documentId)!.join("\n[…]\n");
    return `<source n="${c.n}" title="${c.title.replace(/"/g, "'")}">\n${body}\n</source>`;
  });

  return { citations, contextBlocks };
}

/** Rough confidence (0–4 bars) from hybrid scores. */
export function confidenceFromScores(chunks: RetrievedChunk[]): number {
  if (chunks.length === 0) return 0;
  const top = chunks.slice(0, 3);
  const avg = top.reduce((s, c) => s + c.score, 0) / top.length;
  if (avg > 0.75) return 4;
  if (avg > 0.55) return 3;
  if (avg > 0.35) return 2;
  return 1;
}
