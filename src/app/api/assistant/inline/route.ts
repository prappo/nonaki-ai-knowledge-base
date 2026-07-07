import { NextRequest } from "next/server";
import { chatComplete } from "@/lib/llm";

export const maxDuration = 60;

const SYSTEM_PROMPT = `You are an inline writing assistant inside a document editor. You receive one selected passage from a document, optional surrounding context, and an instruction.

Rules:
- Respond with ONLY the replacement for the selected passage — no preamble, no explanations, no quotes around it, no markdown code fences.
- The replacement must drop cleanly into the passage's place: match the surrounding tone, tense, formatting style and indentation, and keep leading/trailing whitespace conventions sensible.
- Never rewrite or repeat the surrounding context — it is provided only so the replacement fits.
- If the instruction cannot apply to the passage, return the passage unchanged.`;

/**
 * Rewrite one selected passage of a document.
 * body: { text, instruction, title?, before?, after? }
 * Returns { text } — the replacement for the selection only.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    text?: string;
    instruction?: string;
    title?: string;
    before?: string;
    after?: string;
  };
  const text = body.text ?? "";
  const instruction = body.instruction?.trim();
  if (!text.trim() || !instruction) {
    return Response.json({ error: "text and instruction are required" }, { status: 400 });
  }
  if (text.length > 20_000) {
    return Response.json({ error: "Selection too long — select less text" }, { status: 400 });
  }

  const contextParts = [
    body.title ? `Document title: ${body.title}` : null,
    body.before ? `Text immediately BEFORE the selection:\n…${body.before}` : null,
    body.after ? `Text immediately AFTER the selection:\n${body.after}…` : null,
  ].filter(Boolean);

  try {
    let replacement = await chatComplete({
      system: SYSTEM_PROMPT,
      user: `${contextParts.length ? `${contextParts.join("\n\n")}\n\n` : ""}<selection>\n${text}\n</selection>\n\nInstruction: ${instruction}`,
      maxTokens: 4096,
      temperature: 0.4,
      operation: "inline-edit",
    });
    // Strip accidental code fences / wrapping quotes
    replacement = replacement
      .replace(/^```[a-z]*\n?/i, "")
      .replace(/\n?```$/i, "")
      .replace(/^<selection>\n?/i, "")
      .replace(/\n?<\/selection>$/i, "");
    if (!replacement.trim()) {
      return Response.json({ error: "The assistant returned nothing" }, { status: 502 });
    }

    return Response.json({ text: replacement });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Rewrite failed" },
      { status: 502 }
    );
  }
}
