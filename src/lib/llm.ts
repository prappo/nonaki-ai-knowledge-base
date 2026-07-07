import Groq from "groq-sdk";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "./prisma";

/**
 * Multi-provider LLM layer. The active provider is chosen on the Settings
 * page (stored as the `aiProvider` setting); API keys and model overrides
 * live in .env. Every call is metered into the AiUsage table so the Profile
 * page can show token spend.
 */

export type AiProvider = "groq" | "openai" | "anthropic" | "deepseek";

export const PROVIDERS: Record<
  AiProvider,
  { label: string; envKey: string; model: string; note: string }
> = {
  groq: {
    label: "Groq",
    envKey: "GROQ_API_KEY",
    model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
    note: "Fast open-source models, free tier",
  },
  openai: {
    label: "OpenAI",
    envKey: "OPENAI_API_KEY",
    model: process.env.OPENAI_MODEL || "gpt-5.1",
    note: "GPT models",
  },
  anthropic: {
    label: "Claude",
    envKey: "ANTHROPIC_API_KEY",
    model: process.env.ANTHROPIC_MODEL || "claude-opus-4-8",
    note: "Anthropic Claude models",
  },
  deepseek: {
    label: "DeepSeek",
    envKey: "DEEPSEEK_API_KEY",
    model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
    note: "Cost-efficient reasoning models",
  },
};

export function isProvider(value: string): value is AiProvider {
  return value in PROVIDERS;
}

export function providerConfigured(provider: AiProvider): boolean {
  return Boolean(process.env[PROVIDERS[provider].envKey]);
}

/** Provider + thinking mode picked in Settings. Thinking defaults to OFF. */
async function getAiSettings(): Promise<{ provider: AiProvider; thinking: boolean }> {
  let provider: AiProvider = "groq";
  let thinking = false;
  try {
    const rows = await prisma.setting.findMany({
      where: { key: { in: ["aiProvider", "aiThinking"] } },
    });
    for (const row of rows) {
      if (row.key === "aiProvider" && isProvider(row.value)) provider = row.value;
      if (row.key === "aiThinking") thinking = row.value === "true";
    }
  } catch {
    // settings table unreachable — fall through to the defaults
  }
  if (!providerConfigured(provider)) {
    const { label, envKey } = PROVIDERS[provider];
    throw new Error(
      `${label} is selected as the AI provider but ${envKey} is not set in .env`
    );
  }
  return { provider, thinking };
}

/** The provider picked in Settings — throws if its API key is missing. */
export async function getAiProvider(): Promise<AiProvider> {
  return (await getAiSettings()).provider;
}

/* ── clients (cached across hot reloads) ─────────────────────── */

const globalForLlm = globalThis as unknown as {
  groq?: Groq;
  openai?: OpenAI;
  deepseek?: OpenAI;
  anthropic?: Anthropic;
};

function getGroqClient(): Groq {
  return (globalForLlm.groq ??= new Groq());
}

function getOpenAiClient(): OpenAI {
  return (globalForLlm.openai ??= new OpenAI());
}

function getDeepSeekClient(): OpenAI {
  // DeepSeek's API is OpenAI-compatible — official docs point the OpenAI SDK
  // at their base URL.
  return (globalForLlm.deepseek ??= new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: "https://api.deepseek.com",
  }));
}

function getAnthropicClient(): Anthropic {
  return (globalForLlm.anthropic ??= new Anthropic());
}

/* ── usage metering ──────────────────────────────────────────── */

const approxTokens = (text: string) => Math.ceil(text.length / 4);

function recordUsage(args: {
  provider: AiProvider;
  model: string;
  operation: string;
  inputTokens?: number;
  outputTokens?: number;
  /** Fallback material when the provider didn't report usage. */
  inputText: string;
  outputText: string;
}) {
  const estimated = args.inputTokens == null || args.outputTokens == null;
  prisma.aiUsage
    .create({
      data: {
        provider: args.provider,
        model: args.model,
        operation: args.operation,
        inputTokens: args.inputTokens ?? approxTokens(args.inputText),
        outputTokens: args.outputTokens ?? approxTokens(args.outputText),
        estimated,
      },
    })
    .catch(() => {}); // metering must never break the request
}

/* ── unified chat API ────────────────────────────────────────── */

export type ChatRequest = {
  system: string;
  user: string;
  maxTokens?: number;
  /** Ignored by Claude (Opus 4.8 rejects sampling params) and OpenAI GPT-5 models. */
  temperature?: number;
  /** What this call is for — shown on the Profile usage breakdown. */
  operation: string;
};

/** One-shot completion. Returns the assistant's text. */
export async function chatComplete(req: ChatRequest): Promise<string> {
  const { provider, thinking } = await getAiSettings();
  const model = PROVIDERS[provider].model;
  const maxTokens = req.maxTokens ?? 1024;

  if (provider === "anthropic") {
    const msg = await getAnthropicClient().messages.create({
      model,
      max_tokens: maxTokens,
      // Claude thinks adaptively when the Settings toggle is on; omitting the
      // param runs without thinking on Opus 4.8
      ...(thinking ? { thinking: { type: "adaptive" as const } } : {}),
      system: req.system,
      messages: [{ role: "user", content: req.user }],
    });
    if (msg.stop_reason === "refusal") {
      throw new Error("Claude declined this request");
    }
    const text = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    recordUsage({
      provider,
      model,
      operation: req.operation,
      inputTokens: msg.usage.input_tokens,
      outputTokens: msg.usage.output_tokens,
      inputText: req.system + req.user,
      outputText: text,
    });
    return text;
  }

  const messages = [
    { role: "system" as const, content: req.system },
    { role: "user" as const, content: req.user },
  ];
  const completion =
    provider === "groq"
      ? await getGroqClient().chat.completions.create({
          model,
          max_completion_tokens: maxTokens,
          ...(req.temperature != null ? { temperature: req.temperature } : {}),
          messages,
        })
      : provider === "deepseek"
        ? await getDeepSeekClient().chat.completions.create({
            model,
            // DeepSeek only documents max_tokens
            max_tokens: maxTokens,
            // V4's runtime thinking switch; thinking mode rejects temperature
            ...(thinking
              ? { thinking: { type: "enabled" } }
              : req.temperature != null
                ? { temperature: req.temperature }
                : {}),
            messages,
          } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming)
        : // GPT-5-family models reject non-default temperature — omit it
          await getOpenAiClient().chat.completions.create({
            model,
            max_completion_tokens: maxTokens,
            // GPT-5.1 defaults to reasoning_effort "none"
            ...(thinking ? { reasoning_effort: "medium" as const } : {}),
            messages,
          });
  const text = completion.choices[0]?.message?.content ?? "";
  recordUsage({
    provider,
    model,
    operation: req.operation,
    inputTokens: completion.usage?.prompt_tokens,
    outputTokens: completion.usage?.completion_tokens,
    inputText: req.system + req.user,
    outputText: text,
  });
  return text;
}

/** Streaming completion — yields text deltas, meters usage when done. */
export async function* chatStream(req: ChatRequest): AsyncGenerator<string> {
  const { provider, thinking } = await getAiSettings();
  const model = PROVIDERS[provider].model;
  const maxTokens = req.maxTokens ?? 2048;

  if (provider === "anthropic") {
    const stream = getAnthropicClient().messages.stream({
      model,
      max_tokens: maxTokens,
      ...(thinking ? { thinking: { type: "adaptive" as const } } : {}),
      system: req.system,
      messages: [{ role: "user", content: req.user }],
    });
    let text = "";
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        text += event.delta.text;
        yield event.delta.text;
      }
    }
    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal" && !text) {
      throw new Error("Claude declined this request");
    }
    recordUsage({
      provider,
      model,
      operation: req.operation,
      inputTokens: final.usage.input_tokens,
      outputTokens: final.usage.output_tokens,
      inputText: req.system + req.user,
      outputText: text,
    });
    return;
  }

  const messages = [
    { role: "system" as const, content: req.system },
    { role: "user" as const, content: req.user },
  ];
  const completion =
    provider === "groq"
      ? await getGroqClient().chat.completions.create({
          model,
          stream: true,
          max_completion_tokens: maxTokens,
          ...(req.temperature != null ? { temperature: req.temperature } : {}),
          messages,
        })
      : provider === "deepseek"
        ? await getDeepSeekClient().chat.completions.create({
            model,
            stream: true,
            stream_options: { include_usage: true },
            max_tokens: maxTokens,
            ...(thinking
              ? { thinking: { type: "enabled" } }
              : req.temperature != null
                ? { temperature: req.temperature }
                : {}),
            messages,
          } as OpenAI.Chat.ChatCompletionCreateParamsStreaming)
        : await getOpenAiClient().chat.completions.create({
            model,
            stream: true,
            stream_options: { include_usage: true },
            max_completion_tokens: maxTokens,
            ...(thinking ? { reasoning_effort: "medium" as const } : {}),
            messages,
          });

  let text = "";
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  for await (const chunk of completion) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      text += delta;
      yield delta;
    }
    // OpenAI/DeepSeek: final chunk carries usage (via include_usage).
    // Groq: usage rides on the last chunk's x_groq envelope.
    const c = chunk as {
      usage?: { prompt_tokens: number; completion_tokens: number } | null;
      x_groq?: { usage?: { prompt_tokens: number; completion_tokens: number } };
    };
    const usage = c.usage ?? c.x_groq?.usage;
    if (usage) {
      inputTokens = usage.prompt_tokens;
      outputTokens = usage.completion_tokens;
    }
  }
  recordUsage({
    provider,
    model,
    operation: req.operation,
    inputTokens,
    outputTokens,
    inputText: req.system + req.user,
    outputText: text,
  });
}
