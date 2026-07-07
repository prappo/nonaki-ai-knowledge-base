import { generateAnswer } from "./answer";
import { getShareConfig, type BotConfig } from "./share";
import { prisma } from "./prisma";

const GRAPH = "https://graph.facebook.com/v21.0/me";

async function callSendAPI(pageToken: string, body: Record<string, unknown>) {
  const res = await fetch(`${GRAPH}/messages?access_token=${encodeURIComponent(pageToken)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      `Messenger send failed (${res.status}): ${err?.error?.message ?? "unknown"}`
    );
  }
}

/** typing_on / typing_off / mark_seen */
async function sendAction(pageToken: string, psid: string, action: string) {
  await callSendAPI(pageToken, {
    recipient: { id: psid },
    sender_action: action,
  }).catch(() => {});
}

async function sendText(
  pageToken: string,
  psid: string,
  text: string,
  quickReplies?: string[]
) {
  // Messenger caps text messages at 2000 chars
  const chunks = text.match(/[\s\S]{1,1900}/g) ?? [];
  for (let i = 0; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1;
    await callSendAPI(pageToken, {
      recipient: { id: psid },
      messaging_type: "RESPONSE",
      message: {
        text: chunks[i],
        ...(isLast && quickReplies && quickReplies.length > 0
          ? {
              quick_replies: quickReplies.slice(0, 5).map((q) => ({
                content_type: "text",
                title: q.slice(0, 20),
                payload: q.slice(0, 100),
              })),
            }
          : {}),
      },
    });
  }
}

type MessagingEvent = {
  sender?: { id: string };
  message?: { text?: string; is_echo?: boolean; quick_reply?: { payload?: string } };
  postback?: { payload?: string; title?: string };
};

/**
 * Handle one incoming Messenger event: mark seen, show typing, answer from
 * the knowledge base, reply (with quick replies), log the exchange.
 */
export async function handleMessengerEvent(event: MessagingEvent): Promise<void> {
  const config = await getShareConfig("bot");
  if (!config.enabled || !config.pageToken) return;

  const psid = event.sender?.id;
  if (!psid) return;

  // Get Started postback → welcome message
  if (event.postback) {
    await sendText(config.pageToken, psid, config.welcome, config.quickReplies).catch(
      () => {}
    );
    return;
  }

  const message = event.message;
  if (!message || message.is_echo) return;
  const text = message.quick_reply?.payload || message.text;

  if (!text?.trim()) {
    await sendText(
      config.pageToken,
      psid,
      "I can only read text messages for now — type your question and I'll do my best!",
      config.quickReplies
    ).catch(() => {});
    return;
  }

  await sendAction(config.pageToken, psid, "mark_seen");
  await sendAction(config.pageToken, psid, "typing_on");

  try {
    const result = await generateAnswer(text, config.sourceIds, {
      maxTokens: 512,
      stripMarkdown: true, // Messenger renders plain text
    });
    const reply = result.found ? result.answer : config.fallback;
    await sendText(config.pageToken, psid, reply, config.quickReplies);

    prisma.askLog
      .create({
        data: {
          question: text,
          answer: result.found ? result.answer : null,
          citations: JSON.stringify(result.citations),
          mode: "messenger",
        },
      })
      .catch(() => {});
  } catch {
    await sendText(config.pageToken, psid, config.fallback).catch(() => {});
  } finally {
    await sendAction(config.pageToken, psid, "typing_off");
  }
}

/** One-time page profile setup: Get Started button + greeting. */
export async function setupMessengerProfile(config: BotConfig): Promise<void> {
  const res = await fetch(
    `https://graph.facebook.com/v21.0/me/messenger_profile?access_token=${encodeURIComponent(config.pageToken)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        get_started: { payload: "GET_STARTED" },
        greeting: [{ locale: "default", text: config.welcome.slice(0, 160) }],
      }),
      signal: AbortSignal.timeout(15_000),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? `Profile setup failed (${res.status})`);
  }
}
