import { NextRequest } from "next/server";
import { chatStream } from "@/lib/llm";
import { retrieve, buildCitations, confidenceFromScores } from "@/lib/rag";
import { docIdsForSources } from "@/lib/scope";
import { getNumberSetting } from "@/lib/settings";
import { getShareConfig } from "@/lib/share";
import { RAG_SYSTEM_PROMPT } from "@/lib/answer";
import { prisma } from "@/lib/prisma";

export const maxDuration = 300;

/**
 * Public streaming ask endpoint for embedded surfaces (chat widget / KB site).
 * The source scope comes from the SAVED share config — visitors can't widen it.
 */
export async function POST(req: NextRequest) {
  const { question, surface } = (await req.json()) as {
    question?: string;
    surface?: string;
  };
  if (!question?.trim()) {
    return Response.json({ error: "question is required" }, { status: 400 });
  }
  const key = surface === "kb" ? "kb" : "widget";
  const config = await getShareConfig(key);

  let chunks;
  try {
    const limit = await getNumberSetting("retrievalLimit");
    const docIds = await docIdsForSources(
      config.sourceIds.length > 0 ? config.sourceIds : undefined
    );
    chunks = await retrieve(question, limit, docIds);
  } catch {
    return Response.json({ error: "Retrieval failed" }, { status: 500 });
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
          text: "I couldn't find anything about that in the knowledge base — try rephrasing your question.",
        });
        send({ type: "done" });
        controller.close();
        return;
      }

      let answer = "";
      try {
        const deltas = chatStream({
          system: RAG_SYSTEM_PROMPT,
          user: `Knowledge base context:\n\n${contextBlocks.join("\n\n")}\n\nQuestion: ${question}`,
          maxTokens: 1536,
          temperature: 0.2,
          operation: "embed-ask",
        });
        for await (const delta of deltas) {
          answer += delta;
          send({ type: "text", text: delta });
        }
      } catch {
        send({ type: "error", error: "Generation failed — try again." });
      }

      send({ type: "done" });
      controller.close();

      prisma.askLog
        .create({
          data: { question, answer, citations: JSON.stringify(citations), mode: key },
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
