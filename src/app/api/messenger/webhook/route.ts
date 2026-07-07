import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, after } from "next/server";
import { getShareConfig } from "@/lib/share";
import { handleMessengerEvent } from "@/lib/messenger";

export const maxDuration = 60;

/** Webhook verification — Meta calls this once when you subscribe the webhook. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const mode = sp.get("hub.mode");
  const token = sp.get("hub.verify_token");
  const challenge = sp.get("hub.challenge");

  const config = await getShareConfig("bot");
  if (mode === "subscribe" && token && token === config.verifyToken && challenge) {
    return new Response(challenge, { status: 200 });
  }
  return new Response("Verification failed", { status: 403 });
}

/** Incoming messages. Must ACK fast (<20s) — processing happens async. */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const config = await getShareConfig("bot");

  // Signature verification (recommended — set the App Secret in the builder)
  if (config.appSecret) {
    const signature = req.headers.get("x-hub-signature-256") ?? "";
    const expected =
      "sha256=" + createHmac("sha256", config.appSecret).update(raw).digest("hex");
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return new Response("Invalid signature", { status: 403 });
    }
  }

  let body: {
    object?: string;
    entry?: { messaging?: unknown[] }[];
  };
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("Bad payload", { status: 400 });
  }
  if (body.object !== "page") return new Response("Ignored", { status: 404 });

  // ACK immediately; answer after the response is sent (after() keeps the
  // serverless function alive on Vercel — Meta retries on slow responses)
  const events = (body.entry ?? []).flatMap((e) => e.messaging ?? []);
  after(async () => {
    for (const event of events) {
      await handleMessengerEvent(
        event as Parameters<typeof handleMessengerEvent>[0]
      ).catch(() => {});
    }
  });

  return new Response("EVENT_RECEIVED", { status: 200 });
}
