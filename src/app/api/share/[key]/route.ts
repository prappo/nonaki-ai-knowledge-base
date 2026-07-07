import { NextRequest } from "next/server";
import {
  getShareConfig,
  saveShareConfig,
  maskSecret,
  isMasked,
  type ShareKey,
  type BotConfig,
} from "@/lib/share";

const VALID_KEYS: ShareKey[] = ["widget", "bot", "kb"];

function parseKey(key: string): ShareKey | null {
  return (VALID_KEYS as string[]).includes(key) ? (key as ShareKey) : null;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ key: string }> }
) {
  const key = parseKey((await params).key);
  if (!key) return Response.json({ error: "Unknown share key" }, { status: 404 });

  const config = await getShareConfig(key);
  if (key === "bot") {
    const bot = { ...(config as BotConfig) };
    bot.pageToken = maskSecret(bot.pageToken);
    bot.appSecret = maskSecret(bot.appSecret);
    return Response.json({ config: bot });
  }
  return Response.json({ config });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const key = parseKey((await params).key);
  if (!key) return Response.json({ error: "Unknown share key" }, { status: 404 });

  const incoming = (await req.json()) as Record<string, unknown>;
  const current = await getShareConfig(key);
  const next = { ...current, ...incoming };

  // masked secrets mean "keep what's stored"
  if (key === "bot") {
    const bot = next as BotConfig;
    const cur = current as BotConfig;
    if (typeof bot.pageToken !== "string" || isMasked(bot.pageToken)) {
      bot.pageToken = cur.pageToken;
    }
    if (typeof bot.appSecret !== "string" || isMasked(bot.appSecret)) {
      bot.appSecret = cur.appSecret;
    }
  }

  await saveShareConfig(key, next);
  return Response.json({ ok: true });
}
