/**
 * The agent: runs a Release Console for each repo on this machine (bound to
 * 127.0.0.1) and tunnels the control server's UI requests to it.
 *
 * It connects out — a long poll for requests, posts for responses — so the
 * laptop never accepts connections. The console does the release work and
 * applies the safety rules itself (blocked stages, typed versions for
 * permanent stages, approvals for risky commands); the server can only make
 * the same requests its own page could.
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { openRecipe, type OpenedRecipe } from "../recipe/load.ts";
import { defaultLocalDataDir } from "../health/health.ts";
import { agentHome, type AgentConfig, type RepoConfig } from "./config.ts";

export const AGENT_VERSION = "0.4.0";

interface RpcRequest {
  id: string;
  repoId: string;
  method: "GET" | "POST";
  path: string;
  query: string;
  contentType: string | null;
  body: string | null;
}

type RpcPart =
  | { id: string; type: "head"; status: number; headers: Record<string, string> }
  | { id: string; type: "chunk"; data: string }
  | { id: string; type: "end" }
  | { id: string; type: "error"; error: string };

interface Console {
  repo: RepoConfig;
  opened: OpenedRecipe;
  child: ChildProcess | null;
  port: number | null;
  restarts: number;
  /** Taken off this machine: don't restart it when it exits. */
  removed?: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const has = (cmd: string) => !spawnSync(cmd, ["--version"], { stdio: "ignore" }).error;

/** What this machine can do, matched against stage `requires`. */
export function detectCapabilities(extra: string[] = []): string[] {
  const caps = new Set(extra);
  if (has("gh")) caps.add("gh");
  if (has("svn")) caps.add("svn");
  if (has("git")) caps.add("git");
  if (existsSync(path.join(defaultLocalDataDir(), "sites.json"))) caps.add("local-wp");
  // Claude in Chrome drives the user's own browser: a laptop with a desktop session has one
  if (process.platform === "darwin" || process.platform === "win32" || process.env.DISPLAY) caps.add("browser");
  return [...caps].sort();
}

/** The console server: bundled next to the agent, or from source in a checkout. */
function consoleEntry(): string[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const bundled = path.join(here, "console-server.mjs");
  if (existsSync(bundled)) return [bundled];
  return [path.join(here, "../../console/server/index.ts")];
}

export class Agent {
  private readonly config: AgentConfig;
  private readonly consoles = new Map<string, Console>();
  private readonly inflight = new Map<string, AbortController>();
  private outbox: RpcPart[] = [];
  private sending: Promise<void> | null = null;
  private stopped = false;
  private readonly log: (msg: string) => void;
  private readonly fake: boolean;
  capabilities: string[] = [];

  constructor(config: AgentConfig, options: { log?: (msg: string) => void; fake?: boolean } = {}) {
    this.config = config;
    this.fake = options.fake ?? false;
    this.log = options.log ?? ((m) => console.log(`[${new Date().toLocaleTimeString()}] ${m}`));
  }

  // ── consoles ─────────────────────────────────────────────────────────

  async load(): Promise<void> {
    for (const repo of this.config.repos) {
      const opened = await openRecipe(repo.recipe);
      const c: Console = { repo, opened, child: null, port: null, restarts: 0 };
      this.consoles.set(repo.id, c);
      await this.startConsole(c);
    }
    this.capabilities = detectCapabilities(this.config.capabilities);
  }

  /** Start serving a repo now (added from the web app), without restarting the agent. */
  async addRepo(repo: RepoConfig): Promise<void> {
    if (this.consoles.has(repo.id)) throw new Error(`Already serving "${repo.id}".`);
    const opened = await openRecipe(repo.recipe);
    const c: Console = { repo, opened, child: null, port: null, restarts: 0 };
    this.consoles.set(repo.id, c);
    await this.startConsole(c);
  }

  /** Stop serving a repo. Its folder, run history and builds stay where they are. */
  removeRepo(id: string): boolean {
    const c = this.consoles.get(id);
    if (!c) return false;
    c.removed = true;
    this.consoles.delete(id);
    c.child?.kill("SIGTERM");
    return true;
  }

  private startConsole(c: Console): Promise<void> {
    return new Promise((resolve) => {
      const child = spawn(process.execPath, consoleEntry(), {
        env: {
          ...process.env,
          RELEASE_REPO: c.repo.path,
          RELEASE_RECIPE: c.repo.recipe,
          RELEASE_STATE: c.opened.recipe.consoleState
            ? path.join(c.repo.path, c.opened.recipe.consoleState)
            : path.join(agentHome(), "repos", c.repo.id),
          ...(this.fake ? { RELEASE_AGENT_FAKE: "1" } : {}),
          // sessions get the control server's MCP server with this agent's token (Nonaki mode only)
          ...(this.config.server && this.config.token ? { RELEASE_SERVER: this.config.server, RELEASE_AGENT_TOKEN: this.config.token } : {}),
          RELEASE_CHROME: this.capabilities.includes("browser") ? "1" : "0",
        },
        stdio: ["ignore", "pipe", "inherit"],
      });
      c.child = child;
      let ready = false;
      createInterface({ input: child.stdout! }).on("line", (line) => {
        try {
          const msg = JSON.parse(line) as { ready?: boolean; port?: number };
          if (msg.ready && msg.port && !ready) {
            ready = true;
            c.port = msg.port;
            c.restarts = 0;
            this.log(`console for ${c.repo.name} on 127.0.0.1:${msg.port}${this.fake ? " (fake runs)" : ""}`);
            resolve();
            return;
          }
        } catch {
          /* not a control line */
        }
        console.log(`  [${c.repo.id}] ${line}`);
      });
      child.on("exit", (code) => {
        c.port = null;
        c.child = null;
        if (!ready) resolve();
        if (this.stopped || c.removed) return;
        c.restarts++;
        const wait = Math.min(30_000, 1000 * 2 ** Math.min(c.restarts, 5));
        this.log(`console for ${c.repo.name} exited (${code}); restarting in ${Math.round(wait / 1000)}s`);
        setTimeout(() => void this.startConsole(c), wait);
      });
    });
  }

  /** Each repo's console, for the gateway. */
  gatewayProjects() {
    return [...this.consoles.values()].map(({ repo, opened, port }) => ({
      id: repo.id,
      name: repo.name,
      path: repo.path,
      recipe: opened.recipe.name,
      port,
    }));
  }

  repoSummaries() {
    return [...this.consoles.values()].map(({ repo, opened }) => ({
      id: repo.id,
      name: repo.name,
      recipe: opened.recipe.name,
      groups: opened.recipe.groups,
      versionHint: opened.recipe.version.hint,
    }));
  }

  // ── server I/O ───────────────────────────────────────────────────────

  private async api(method: "GET" | "POST", pathname: string, body?: unknown): Promise<unknown> {
    if (!this.config.server || !this.config.token) throw new Error("Not paired with a Nonaki server. Run `release-agent pair` first.");
    const res = await fetch(new URL(pathname, this.config.server), {
      method,
      headers: { authorization: `Bearer ${this.config.token}`, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.status === 401) throw new Error("The server doesn't know this agent any more (unpaired?). Run `release-agent pair` again.");
    if (!res.ok) throw new Error(String(data.error ?? `HTTP ${res.status}`));
    return data;
  }

  private send(part: RpcPart): void {
    this.outbox.push(part);
    if (!this.sending) this.sending = this.flush().finally(() => (this.sending = null));
  }

  /** Post response parts in order, batching whatever queued while the last post was in flight. */
  private async flush(): Promise<void> {
    let delay = 500;
    while (this.outbox.length && !this.stopped) {
      const batch = this.outbox.splice(0, 200);
      try {
        await this.api("POST", "/api/agent/rpc", { parts: batch });
        delay = 500;
      } catch (e) {
        this.outbox.unshift(...batch);
        this.log(`couldn't send a response: ${(e as Error).message} — retrying`);
        await sleep(delay);
        delay = Math.min(delay * 2, 10_000);
      }
    }
  }

  async hello(): Promise<void> {
    await this.api("POST", "/api/agent/hello", { capabilities: this.capabilities, repos: this.repoSummaries(), version: AGENT_VERSION });
  }

  /** Long-poll for tunnelled requests until stop(). Survives the server or network going away. */
  async run(): Promise<void> {
    await this.hello();
    this.log(`connected to ${this.config.server} as "${this.config.name}" · capabilities: ${this.capabilities.join(", ")}`);
    let delay = 1000;
    while (!this.stopped) {
      try {
        const work = (await this.api("GET", "/api/agent/commands?wait=25")) as { rpc?: RpcRequest[]; cancel?: string[] };
        delay = 1000;
        for (const id of work.cancel ?? []) this.inflight.get(id)?.abort();
        for (const req of work.rpc ?? []) void this.proxy(req);
      } catch (e) {
        if (this.stopped) break;
        this.log(`server unreachable: ${(e as Error).message} — retrying in ${Math.round(delay / 1000)}s`);
        await sleep(delay);
        delay = Math.min(delay * 2, 30_000);
      }
    }
  }

  stop(): void {
    this.stopped = true;
    for (const c of this.consoles.values()) c.child?.kill("SIGTERM");
    for (const ctl of this.inflight.values()) ctl.abort();
  }

  // ── the tunnel ───────────────────────────────────────────────────────

  /** Make the request against the repo's console and stream the response back. */
  private async proxy(req: RpcRequest): Promise<void> {
    const c = this.consoles.get(req.repoId);
    if (!c?.port) {
      this.send({ id: req.id, type: "error", error: c ? `The console for ${c.repo.name} is restarting. Try again in a moment.` : `This agent doesn't serve "${req.repoId}".` });
      return;
    }
    if (!req.path.startsWith("/api/")) {
      this.send({ id: req.id, type: "error", error: "Only the console API is tunnelled." });
      return;
    }

    const ctl = new AbortController();
    this.inflight.set(req.id, ctl);
    try {
      const res = await fetch(`http://127.0.0.1:${c.port}${req.path}${req.query ? `?${req.query}` : ""}`, {
        method: req.method,
        headers: req.contentType ? { "content-type": req.contentType } : {},
        body: req.method === "POST" && req.body !== null ? Buffer.from(req.body, "base64") : undefined,
        signal: ctl.signal,
      });
      this.send({ id: req.id, type: "head", status: res.status, headers: Object.fromEntries(res.headers.entries()) });
      if (res.body) {
        // forward chunks as they come (event streams stay open), coalescing bursts
        let buffered: Buffer[] = [];
        let size = 0;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const flushChunk = () => {
          if (timer) clearTimeout(timer);
          timer = null;
          if (!size) return;
          this.send({ id: req.id, type: "chunk", data: Buffer.concat(buffered).toString("base64") });
          buffered = [];
          size = 0;
        };
        for await (const chunk of res.body) {
          buffered.push(Buffer.from(chunk));
          size += chunk.length;
          if (size > 256 * 1024) flushChunk();
          else timer ??= setTimeout(flushChunk, 30);
        }
        flushChunk();
      }
      this.send({ id: req.id, type: "end" });
    } catch (e) {
      if (!ctl.signal.aborted) this.send({ id: req.id, type: "error", error: (e as Error).message });
    } finally {
      this.inflight.delete(req.id);
    }
  }
}
