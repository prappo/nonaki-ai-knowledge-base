import { NextRequest } from "next/server";
import { chatStream } from "@/lib/llm";
import { retrieve, buildCitations, confidenceFromScores, toRetrievalMode } from "@/lib/rag";
import { prisma } from "@/lib/prisma";
import { getNumberSetting } from "@/lib/settings";
import { docIdsForSources } from "@/lib/scope";

export const maxDuration = 300;

const SYSTEM_PROMPT = `You are Nonaki, an AI assistant that answers questions strictly from a company knowledge base.

Rules:
- Answer ONLY from the provided <source> context. If the context does not contain the answer, say you don't have that information in the knowledge base — never invent facts.
- Cite sources inline using the source's n number in square brackets, e.g. [1], [2], placed right after the claim it supports. Every factual claim needs a citation.
- Be concise and direct. Use short paragraphs. Bold key terms with **markdown**.
- Never refer to the material itself (no "based on the provided sources/context") — just answer naturally with [n] citations.`;

export async function POST(req: NextRequest) {
  const { question, sourceIds, retrieval } = (await req.json()) as {
    question?: string;
    sourceIds?: string[];
    retrieval?: string;
  };
  if (!question?.trim()) {
    return Response.json({ error: "question is required" }, { status: 400 });
  }

  let chunks;
  try {
    const limit = await getNumberSetting("retrievalLimit");
    const docIds = await docIdsForSources(sourceIds);
    chunks = await retrieve(question, limit, docIds, toRetrievalMode(retrieval));
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Retrieval failed" },
      { status: 500 }
    );
  }

  const { citations, contextBlocks } = buildCitations(chunks);
  const confidence = confidenceFromScores(chunks);

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

      send({ type: "meta", citations, confidence });

      if (chunks.length === 0) {
        send({
          type: "text",
          text: "Nothing in the selected sources matched your question. Widen the scope, connect a data source, or upload documents first.",
        });
        send({ type: "done" });
        controller.close();
        return;
      }

      let answer = "";
      try {
        const deltas = chatStream({
          system: SYSTEM_PROMPT,
          user: `Knowledge base context:\n\n${contextBlocks.join("\n\n")}\n\nQuestion: ${question}`,
          maxTokens: 2048,
          temperature: 0.2,
          operation: "ask",
        });
        for await (const delta of deltas) {
          answer += delta;
          send({ type: "text", text: delta });
        }
      } catch (err) {
        send({
          type: "error",
          error: err instanceof Error ? err.message : "Generation failed",
        });
      }

      send({ type: "done" });
      controller.close();

      prisma.askLog
        .create({
          data: {
            question,
            answer,
            citations: JSON.stringify(citations),
            mode: "ask",
          },
        })
        .catch(() => {});
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
