/**
 * Talking to the Release Console web app: linking this machine with a
 * one-time code, and the heartbeat that says it's up and where to reach it.
 */

import path from "node:path";
import { homedir } from "node:os";
import { publicKeyFrom } from "./token.ts";
import type { WebLink } from "../agent/config.ts";

/** https, or plain http on loopback (local development). */
export function checkAppUrl(value: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} isn't a URL: ${value}`);
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) throw new Error(`${label} must be https:// (http is only for localhost).`);
  return url;
}

/** `~/Projects` → an absolute folder. */
export function expandFolder(folder: string): string {
  const expanded = folder === "~" ? homedir() : folder.startsWith("~/") ? path.join(homedir(), folder.slice(2)) : folder;
  return path.resolve(expanded);
}

export async function linkMachine(input: {
  app: string;
  code: string;
  version: string;
  tunnelUrl?: string;
  port: number;
  allowedRoots: string[];
}): Promise<WebLink> {
  const app = checkAppUrl(input.app, "The app URL");
  const res = await fetch(new URL("/api/gateway/pair", app), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: input.code, version: input.version, tunnelUrl: input.tunnelUrl, allowedRoots: input.allowedRoots }),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, string | undefined>;
  if (!res.ok) throw new Error(data.error ?? `Linking failed (HTTP ${res.status}).`);
  const { machineId, machineName, ownerId, ownerEmail, appOrigin, publicKey, secret } = data;
  if (!machineId || !machineName || !ownerId || !ownerEmail || !appOrigin || !publicKey || !secret) throw new Error("The app sent an incomplete answer.");
  if (appOrigin !== app.origin) throw new Error(`The app says it lives at ${appOrigin}, not ${app.origin}. Link with that address.`);
  publicKeyFrom(publicKey); // refuse anything but an Ed25519 key now, not at the first request
  return { app: app.origin, machineId, machineName, ownerId, ownerEmail, publicKey, secret, tunnelUrl: input.tunnelUrl, port: input.port };
}

export type HeartbeatResult = { ok: true } | { ok: false; revoked: boolean; error: string };

export async function sendHeartbeat(link: WebLink, body: { version: string; allowedRoots: string[] }): Promise<HeartbeatResult> {
  try {
    const res = await fetch(new URL("/api/gateway/heartbeat", link.app), {
      method: "POST",
      headers: { authorization: `Bearer ${link.secret}`, "content-type": "application/json" },
      body: JSON.stringify({ ...body, tunnelUrl: link.tunnelUrl }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string; revoked?: boolean };
    if (res.ok) return { ok: true };
    return { ok: false, revoked: res.status === 401 && data.revoked === true, error: data.error ?? `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, revoked: false, error: (err as Error).message };
  }
}
