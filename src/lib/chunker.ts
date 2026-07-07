import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

// LangChain recursive splitter — splits on paragraphs first, then sentences,
// then words, keeping chunks semantically coherent for embedding.
export async function chunkText(
  text: string,
  opts: { chunkSize?: number; chunkOverlap?: number } = {}
): Promise<string[]> {
  const chunkSize = opts.chunkSize ?? 1200;
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap: opts.chunkOverlap ?? Math.round(chunkSize / 8),
    separators: ["\n\n", "\n", ". ", " ", ""],
  });

  const cleaned = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!cleaned) return [];
  const chunks = await splitter.splitText(cleaned);
  return chunks.map((c) => c.trim()).filter((c) => c.length > 0);
}
