/**
 * The Cloudflare Tunnel that publishes the gateway at https://<hostname>,
 * set up with the user's own `cloudflared`: sign in (once), a named tunnel
 * for this machine, a DNS record for the hostname, and a config file that
 * sends that hostname to the gateway on 127.0.0.1. Nothing listens on a
 * public port; cloudflared connects out to Cloudflare.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir, hostname as osHostname } from "node:os";
import path from "node:path";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs a command and collects its output; tests pass their own. */
export type Runner = (command: string, args: string[]) => Promise<RunResult>;

export const runCommand: Runner = (command, args) =>
  new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) => resolve({ code: 127, stdout, stderr: err.message }));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });

export class TunnelError extends Error {}

export const cloudflaredHome = () => path.join(homedir(), ".cloudflared");

/** cloudflared on PATH, or where the installers put it. */
export function findCloudflared(): string | null {
  const which = spawnSync(process.platform === "win32" ? "where" : "which", ["cloudflared"], { encoding: "utf8" });
  const found = which.status === 0 ? which.stdout.split(/\r?\n/)[0].trim() : "";
  if (found) return found;
  return ["/opt/homebrew/bin/cloudflared", "/usr/local/bin/cloudflared", "/usr/bin/cloudflared"].find((p) => existsSync(p)) ?? null;
}

export function installHint(platform = process.platform): string {
  if (platform === "darwin") return "brew install cloudflared";
  if (platform === "win32") return "winget install --id Cloudflare.cloudflared";
  return "see https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/";
}

/** A hostname on the user's Cloudflare zone, e.g. agent.example.com. */
export function checkHostname(value: string): string {
  const host = value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const label = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
  const parts = host.split(".");
  if (host.length > 253 || parts.length < 2 || !parts.every((p) => label.test(p)) || /^\d+$/.test(parts.at(-1)!)) {
    throw new TunnelError(`"${value}" isn't a hostname. Use one on a domain in your Cloudflare account, e.g. agent.example.com`);
  }
  return host;
}

/** A tunnel name for this machine: release-agent-<host name>. */
export function defaultTunnelName(host = osHostname()): string {
  const slug = host.toLowerCase().replace(/\.local$/, "").replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return `release-agent-${slug || "machine"}`;
}

export function tunnelConfigYaml(input: { id: string; credentialsFile: string; hostname: string; port: number }): string {
  const q = (s: string) => JSON.stringify(s); // YAML accepts JSON strings
  return `# Written by release-agent (release-agent tunnel setup). Sends ${input.hostname} to the gateway.
tunnel: ${q(input.id)}
credentials-file: ${q(input.credentialsFile)}
ingress:
  - hostname: ${q(input.hostname)}
    service: ${q(`http://127.0.0.1:${input.port}`)}
  - service: http_status:404
`;
}

interface Tunnel {
  id: string;
  name: string;
}

async function listTunnels(run: Runner, bin: string): Promise<Tunnel[]> {
  const res = await run(bin, ["tunnel", "list", "--output", "json"]);
  if (res.code !== 0) throw new TunnelError(`cloudflared couldn't list your tunnels: ${res.stderr.trim() || res.stdout.trim()}`);
  try {
    return (JSON.parse(res.stdout || "[]") as Tunnel[]) ?? [];
  } catch {
    throw new TunnelError("cloudflared listed the tunnels in an unexpected format.");
  }
}

export interface TunnelSetup {
  name: string;
  id: string;
  hostname: string;
  configFile: string;
  credentialsFile: string;
}

/**
 * Make (or reuse) the tunnel, route the hostname to it, and write its config.
 * `login` runs `cloudflared tunnel login` with the terminal attached, when
 * this machine hasn't signed in to Cloudflare yet.
 */
export async function setupTunnel(input: {
  hostname: string;
  name: string;
  port: number;
  configFile: string;
  bin: string;
  run?: Runner;
  login: () => Promise<boolean>;
  overwriteDns?: boolean;
  log?: (message: string) => void;
  cfHome?: string;
}): Promise<TunnelSetup> {
  const run = input.run ?? runCommand;
  const log = input.log ?? (() => {});
  const cfHome = input.cfHome ?? cloudflaredHome();
  const hostname = checkHostname(input.hostname);

  if (!existsSync(path.join(cfHome, "cert.pem")) && !process.env.TUNNEL_ORIGIN_CERT) {
    log("Sign in to Cloudflare in the browser window that opens, and pick the domain for this hostname…");
    if (!(await input.login()) || !existsSync(path.join(cfHome, "cert.pem"))) throw new TunnelError("Cloudflare sign-in didn't finish. Run the command again.");
  }

  let tunnel = (await listTunnels(run, input.bin)).find((t) => t.name === input.name);
  if (tunnel) log(`Using your tunnel "${input.name}".`);
  else {
    const created = await run(input.bin, ["tunnel", "create", input.name]);
    if (created.code !== 0) throw new TunnelError(`cloudflared couldn't create the tunnel: ${created.stderr.trim() || created.stdout.trim()}`);
    tunnel = (await listTunnels(run, input.bin)).find((t) => t.name === input.name);
    if (!tunnel) throw new TunnelError("cloudflared created the tunnel, but it isn't listed.");
    log(`Created the tunnel "${input.name}".`);
  }

  const credentialsFile = path.join(cfHome, `${tunnel.id}.json`);
  if (!existsSync(credentialsFile)) {
    throw new TunnelError(
      `The tunnel "${input.name}" exists, but this machine doesn't have its credentials (${credentialsFile}). It was probably made on another machine: pass another --name, or delete it with: cloudflared tunnel delete ${input.name}`
    );
  }

  const route = await run(input.bin, ["tunnel", "route", "dns", ...(input.overwriteDns ? ["--overwrite-dns"] : []), tunnel.id, hostname]);
  if (route.code !== 0) {
    const why = `${route.stderr}\n${route.stdout}`;
    if (/already (exists|configured)|record with that host already exists/i.test(why)) {
      throw new TunnelError(`${hostname} already has a DNS record. If it's yours to replace, run again with --overwrite-dns. Otherwise pick another hostname.`);
    }
    throw new TunnelError(`cloudflared couldn't point ${hostname} at the tunnel: ${why.trim()}`);
  }
  log(`Pointed ${hostname} at the tunnel.`);

  mkdirSync(path.dirname(input.configFile), { recursive: true, mode: 0o700 });
  writeFileSync(input.configFile, tunnelConfigYaml({ id: tunnel.id, credentialsFile, hostname, port: input.port }), { mode: 0o600 });
  return { name: input.name, id: tunnel.id, hostname, configFile: input.configFile, credentialsFile };
}

/** `cloudflared tunnel login`, with the terminal attached (it opens the browser). */
export function interactiveLogin(bin: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(bin, ["tunnel", "login"], { stdio: "inherit" });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

export const tunnelRunArgs = (configFile: string) => ["tunnel", "--no-autoupdate", "--config", configFile, "run"];
