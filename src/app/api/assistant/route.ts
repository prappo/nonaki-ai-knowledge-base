import { NextRequest } from "next/server";
import { chatComplete } from "@/lib/llm";
import { prisma } from "@/lib/prisma";
import { log } from "@/lib/indexer";

export const maxDuration = 300;

const SYSTEM_PROMPT = `You are Nonaki's document assistant. You revise knowledge-base documents based on an instruction.

You will receive the current document and an instruction. Respond with ONLY the full revised document as plain text — no preamble, no explanations, no markdown code fences. Apply the instruction while preserving everything that should not change. Keep the document's structure, tone and formatting style.`;

/**
 * Ask the LLM to draft a revision of a document.
 * The draft is saved as a pending proposal — nothing publishes until approved.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as { documentId?: string; instruction?: string };
  if (!body.documentId || !body.instruction?.trim()) {
    return Response.json(
      { error: "documentId and instruction are required" },
      { status: 400 }
    );
  }

  const doc = await prisma.document.findUnique({ where: { id: body.documentId } });
  if (!doc) return Response.json({ error: "Document not found" }, { status: 404 });

  try {
    const completion = await chatComplete({
      system: SYSTEM_PROMPT,
      user: `<document title="${doc.title.replace(/"/g, "'")}">\n${doc.content}\n</document>\n\nInstruction: ${body.instruction}`,
      maxTokens: 8192,
      temperature: 0.3,
      operation: "assistant-draft",
    });

    let newContent = completion.trim();
    // Strip accidental code fences
    newContent = newContent.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();

    if (!newContent) {
      return Response.json({ error: "The assistant returned no draft" }, { status: 502 });
    }

    const proposal = await prisma.proposal.create({
      data: {
        documentId: doc.id,
        type: "update",
        origin: "assistant",
        reason: `AI-drafted: ${body.instruction}`,
        oldContent: doc.content,
        newContent,
      },
    });
    await log(`Assistant drafted an update for "${doc.title}" — waiting for review`);

    return Response.json({ proposal });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Draft failed" },
      { status: 502 }
    );
  }
}
