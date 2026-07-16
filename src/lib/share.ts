import { randomBytes } from "node:crypto";
import { prisma } from "./prisma";

/** Chat widget embedded on the user's website. */
export type WidgetConfig = {
  name: string;
  greeting: string;
  color: string;
  position: "right" | "left";
  sourceIds: string[]; // [] = all sources
  showCitations: boolean;
  suggestions: string[];
};

/** Social messenger bot (Facebook Messenger). */
export type BotConfig = {
  enabled: boolean;
  verifyToken: string;
  pageToken: string;
  appSecret: string;
  sourceIds: string[];
  welcome: string;
  fallback: string;
  quickReplies: string[];
};

/** Public knowledge-base site. */
export type KbConfig = {
  title: string;
  description: string;
  accent: string;
  theme: "light" | "dark";
  layout: "cards" | "list";
  sourceIds: string[];
  showAsk: boolean;
};

/** MCP server for AI clients (Claude, Cursor, …). */
export type McpConfig = {
  enabled: boolean;
  apiKey: string;
  sourceIds: string[];
};

export type ShareKey = "widget" | "bot" | "kb" | "mcp";
type AnyConfig = WidgetConfig | BotConfig | KbConfig | McpConfig;

const DEFAULTS: { widget: WidgetConfig; bot: BotConfig; kb: KbConfig; mcp: McpConfig } = {
  widget: {
    name: "Nonaki Assistant",
    greeting: "Hi! 👋 Ask me anything — I answer from our knowledge base.",
    color: "#0e7f93",
    position: "right",
    sourceIds: [],
    showCitations: true,
    suggestions: ["What can you help me with?", "How do I get started?"],
  },
  bot: {
    enabled: false,
    verifyToken: "",
    pageToken: "",
    appSecret: "",
    sourceIds: [],
    welcome:
      "Hi! 👋 I'm an AI assistant. Ask me anything and I'll answer from our knowledge base.",
    fallback:
      "Sorry, I couldn't find anything about that in our knowledge base. A team member will get back to you.",
    quickReplies: ["What can you help with?", "Talk to a human"],
  },
  kb: {
    title: "Knowledge Base",
    description: "Guides, answers and documentation — searchable and AI-powered.",
    accent: "#0e7f93",
    theme: "light",
    layout: "cards",
    sourceIds: [],
    showAsk: true,
  },
  mcp: {
    enabled: false,
    apiKey: "",
    sourceIds: [],
  },
};

const SETTING_KEY = (key: ShareKey) => `share:${key}`;

export async function getShareConfig<K extends ShareKey>(
  key: K
): Promise<(typeof DEFAULTS)[K]> {
  const row = await prisma.setting.findUnique({ where: { key: SETTING_KEY(key) } });
  const stored = row ? (JSON.parse(row.value) as Partial<(typeof DEFAULTS)[K]>) : {};
  const merged = { ...DEFAULTS[key], ...stored };
  // first read of the bot config mints a verify token so setup is one less step
  if (key === "bot" && !(merged as BotConfig).verifyToken) {
    (merged as BotConfig).verifyToken = randomBytes(12).toString("hex");
    await saveShareConfig("bot", merged as BotConfig);
  }
  // same for the MCP API key — saving an empty key regenerates it
  if (key === "mcp" && !(merged as McpConfig).apiKey) {
    (merged as McpConfig).apiKey = `nk_mcp_${randomBytes(24).toString("hex")}`;
    await saveShareConfig("mcp", merged as McpConfig);
  }
  return merged;
}

export async function saveShareConfig(key: ShareKey, config: AnyConfig): Promise<void> {
  await prisma.setting.upsert({
    where: { key: SETTING_KEY(key) },
    create: { key: SETTING_KEY(key), value: JSON.stringify(config) },
    update: { value: JSON.stringify(config) },
  });
}

export function maskSecret(value: string): string {
  if (!value) return "";
  return `••••${value.slice(-4)}`;
}

export const isMasked = (value: string) => value.startsWith("••••");
