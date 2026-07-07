import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { PROVIDERS, isProvider, providerConfigured, type AiProvider } from "@/lib/llm";

const SETTING_DEFAULTS: Record<string, string> = {
  answerVerifiedOnly: "false",
  requireCitations: "true",
  chunkSize: "1200",
  chunkOverlap: "150",
  retrievalLimit: "8",
  aiProvider: "groq",
  aiThinking: "false",
};

export async function GET() {
  const rows = await prisma.setting.findMany();
  const settings = { ...SETTING_DEFAULTS };
  for (const row of rows) settings[row.key] = row.value;
  const providers = (Object.keys(PROVIDERS) as AiProvider[]).map((id) => ({
    id,
    label: PROVIDERS[id].label,
    model: PROVIDERS[id].model,
    note: PROVIDERS[id].note,
    envKey: PROVIDERS[id].envKey,
    configured: providerConfigured(id),
  }));
  return Response.json({ settings, providers });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Record<string, string>;
  if (body.aiProvider !== undefined) {
    if (!isProvider(body.aiProvider)) {
      return Response.json({ error: "Unknown AI provider" }, { status: 400 });
    }
    if (!providerConfigured(body.aiProvider)) {
      return Response.json(
        { error: `${PROVIDERS[body.aiProvider].envKey} is not set in .env` },
        { status: 400 }
      );
    }
  }
  if (body.aiThinking !== undefined && !["true", "false"].includes(body.aiThinking)) {
    return Response.json({ error: "aiThinking must be true or false" }, { status: 400 });
  }
  const changed: Record<string, { from: string | null; to: string }> = {};
  for (const [key, value] of Object.entries(body)) {
    const prev = await prisma.setting.findUnique({ where: { key } });
    if (prev?.value === String(value)) continue;
    await prisma.setting.upsert({
      where: { key },
      create: { key, value: String(value) },
      update: { value: String(value) },
    });
    changed[key] = { from: prev?.value ?? null, to: String(value) };
  }
  const keys = Object.keys(changed);
  if (keys.length > 0) {
    await audit("setting.changed", `Settings updated: ${keys.join(", ")}`, {
      entityType: "setting",
      detail: changed,
    });
  }
  return Response.json({ ok: true });
}
