import { createHash, randomBytes } from "node:crypto";
import { prisma } from "./prisma";

/**
 * Releases: a release-agent on someone's laptop runs a Release Console for
 * each repo it serves; this app embeds that console's UI and tunnels its API
 * to the agent (see releaseTunnel.ts). The agent connects out — no inbound
 * ports on the laptop.
 *
 * Safety rules (risk approvals, typed versions for permanent stages, blocked
 * stages) are enforced by the console on the agent's machine; this server is
 * not trusted to waive them.
 */

export interface AgentRepo {
  id: string;
  name: string;
  recipe: string;
  groups: { id: string; label: string }[];
  versionHint?: string;
}

/** An agent counts as online when it polled this recently. */
export const ONLINE_MS = 45_000;

/** Oldest agent that speaks the console tunnel. */
export const MIN_AGENT_VERSION = "0.3.0";

export function versionAtLeast(version: string | null | undefined, min: string): boolean {
  if (!version) return false;
  const a = version.split(".").map((n) => parseInt(n, 10) || 0);
  const b = min.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
}

// ── tokens & pairing ─────────────────────────────────────────────────────

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function newAgentToken(): string {
  return `nk_agent_${randomBytes(32).toString("hex")}`;
}

/** 8 characters from an unambiguous alphabet, shown as XXXX-XXXX. */
export function newPairingCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}

/** The agent behind a request's bearer token, or null. Also marks it seen. */
export async function agentFromRequest(req: Request) {
  const header = req.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!token.startsWith("nk_agent_")) return null;
  const agent = await prisma.releaseAgent.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!agent) return null;
  await prisma.releaseAgent.update({ where: { id: agent.id }, data: { lastSeenAt: new Date() } });
  return agent;
}

export const unauthorized = () =>
  Response.json({ error: "Unknown or revoked agent token — pair again." }, { status: 401 });

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  try {
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function agentView(agent: {
  id: string;
  name: string;
  capabilities: string;
  repos: string;
  version: string | null;
  lastSeenAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: agent.id,
    name: agent.name,
    capabilities: parseJson<string[]>(agent.capabilities, []),
    repos: parseJson<AgentRepo[]>(agent.repos, []),
    version: agent.version,
    lastSeenAt: agent.lastSeenAt?.toISOString() ?? null,
    online: Boolean(agent.lastSeenAt && Date.now() - agent.lastSeenAt.getTime() < ONLINE_MS),
    outdated: !versionAtLeast(agent.version, MIN_AGENT_VERSION),
    minVersion: MIN_AGENT_VERSION,
    createdAt: agent.createdAt.toISOString(),
  };
}
