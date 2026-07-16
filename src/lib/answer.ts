import { chatComplete } from "./llm";
import { retrieve, buildCitations, confidenceFromScores, type Citation } from "./rag";
import { docIdsForSources } from "./scope";
import { getNumberSetting } from "./settings";

export const RAG_SYSTEM_PROMPT = `You are a helpful AI assistant that answers questions strictly from a company knowledge base.

Rules:
- Answer ONLY from the provided <source> context. If the context does not contain the answer, say you don't have that information — never invent facts.
- Cite sources inline using the source's n number in square brackets, e.g. [1], [2], placed right after the claim it supports.
- Be concise and direct. Use short paragraphs. Bold key terms with **markdown**.
- Never refer to the material itself (no "based on the provided sources/context") — just answer naturally with [n] citations.`;

export type AnswerResult = {
  answer: string;
  citations: Citation[];
  confidence: number;
  found: boolean;
};

/**
 * Non-streaming RAG answer (used by the Messenger bot and the MCP server).
 * Plain-text friendly: pass stripMarkdown to remove ** and [n] markers.
 */
export async function generateAnswer(
  question: string,
  sourceIds?: string[],
  opts: { maxTokens?: number; stripMarkdown?: boolean; operation?: string } = {}
): Promise<AnswerResult> {
  const limit = await getNumberSetting("retrievalLimit");
  const docIds = await docIdsForSources(
    sourceIds && sourceIds.length > 0 ? sourceIds : undefined
  );
  const chunks = await retrieve(question, limit, docIds);
  if (chunks.length === 0) {
    return { answer: "", citations: [], confidence: 0, found: false };
  }

  const { citations, contextBlocks } = buildCitations(chunks);
  const completion = await chatComplete({
    system: RAG_SYSTEM_PROMPT,
    user: `Knowledge base context:\n\n${contextBlocks.join("\n\n")}\n\nQuestion: ${question}`,
    maxTokens: opts.maxTokens ?? 1024,
    temperature: 0.2,
    operation: opts.operation ?? "messenger",
  });

  let answer = completion.trim();
  if (opts.stripMarkdown) {
    answer = answer
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\s?\[\d+\]/g, "")
      .trim();
  }

  return {
    answer,
    citations,
    confidence: confidenceFromScores(chunks),
    found: answer.length > 0,
  };
}
