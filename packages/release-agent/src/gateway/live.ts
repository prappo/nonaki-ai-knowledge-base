/**
 * Live status for the web app: one event stream per machine (GET /events),
 * carrying every project's branch, uncommitted changes, live run and agent
 * session, and latest CI build, as they change.
 *
 * Work happens only while someone is watching. Each tick asks git and each
 * project's console (GET /api/live, cheap) and sends a project only when its
 * status changed. A watcher on each repo's .git folder makes branch switches
 * and commits show at once; working-tree edits show by the next tick. CI is
 * asked of GitHub less often, and faster while a build is running.
 */

import { watch, type FSWatcher } from "node:fs";
import type http from "node:http";
import path from "node:path";
import { runGit, type GitRunner } from "../repo/git.ts";
import type { GatewayProject } from "./server.ts";

export interface LiveRun {
  id: string;
  stageId: string;
  title: string | null;
  version: string;
  prompt: string;
  status: string;
  active: boolean;
  needsYou: boolean;
  startedAt: number;
  endedAt: number | null;
}

export interface LiveCi {
  status: string;
  conclusion: string | null;
  branch: string;
  url: string;
  createdAt: string;
}

export interface ProjectStatus {
  id: string;
  name: string;
  ready: boolean;
  branch: string | null;
  /** Files changed, staged or untracked. */
  changes: number;
  ahead: number;
  behind: number;
  run: LiveRun | null;
  chat: LiveRun | null;
  /** The newest CI build on this branch; null when there's none, or no CI for this project. */
  ci: LiveCi | null;
}

/** How the hub reads a project's console; tests pass their own. */
export type ConsoleReader = (port: number, path: string) => Promise<unknown>;

const readConsole: ConsoleReader = async (port, p) => {
  const res = await fetch(`http://127.0.0.1:${port}${p}`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

/** `## branch...origin/branch [ahead 1, behind 2]` and the file lines of `git status -b --porcelain`. */
export function parseStatus(output: string): { branch: string | null; changes: number; ahead: number; behind: number } {
  const lines = output.split("\n").filter(Boolean);
  const head = lines[0]?.startsWith("## ") ? lines.shift()!.slice(3) : "";
  const branch = head.startsWith("HEAD (no branch)") || !head ? null : head.replace(/^No commits yet on /, "").split("...")[0].split(" ")[0];
  const ahead = Number(head.match(/ahead (\d+)/)?.[1] ?? 0);
  const behind = Number(head.match(/behind (\d+)/)?.[1] ?? 0);
  return { branch, changes: lines.length, ahead, behind };
}

export interface LiveOptions {
  projects: () => GatewayProject[];
  git?: GitRunner;
  readConsole?: ConsoleReader;
  /** Between ticks while watched (ms). */
  interval?: number;
  /** Between CI checks, and while a CI build runs (ms). */
  ciInterval?: number;
  ciActiveInterval?: number;
  /** Comment lines that keep proxies from closing an idle stream (ms). */
  keepAlive?: number;
  /** Watch .git folders for instant updates (off in tests). */
  watchGit?: boolean;
}

export class LiveHub {
  private readonly clients = new Set<http.ServerResponse>();
  private readonly last = new Map<string, string>();
  private readonly statuses = new Map<string, ProjectStatus>();
  private readonly ci = new Map<string, { at: number; value: LiveCi | null }>();
  private readonly watchers = new Map<string, FSWatcher>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private keepAlive: ReturnType<typeof setInterval> | null = null;
  private soon: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private seq = 0;
  private readonly git: GitRunner;
  private readonly read: ConsoleReader;
  private readonly options: LiveOptions;

  constructor(options: LiveOptions) {
    this.options = options;
    this.git = options.git ?? runGit;
    this.read = options.readConsole ?? readConsole;
  }

  get watching(): number {
    return this.clients.size;
  }

  /** Stream to this response until it closes: a snapshot first, then changes. */
  subscribe(req: http.IncomingMessage, res: http.ServerResponse): void {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
      connection: "keep-alive",
    });
    res.write("retry: 3000\n\n");
    this.clients.add(res);
    req.on("close", () => this.unsubscribe(res));

    if (this.clients.size === 1) this.start();
    // Whatever is known now; a fresh look right after sends what changed.
    this.send(res, "snapshot", { projects: [...this.statuses.values()] });
    void this.tick();
  }

  /** Something changed (a project added or removed): look again now. */
  poke(): void {
    if (!this.clients.size || this.soon) return;
    this.soon = setTimeout(() => {
      this.soon = null;
      void this.tick();
    }, 150);
  }

  close(): void {
    for (const res of this.clients) res.end();
    this.clients.clear();
    this.stop();
  }

  private unsubscribe(res: http.ServerResponse) {
    this.clients.delete(res);
    if (!this.clients.size) this.stop();
  }

  private start() {
    this.timer = setInterval(() => void this.tick(), this.options.interval ?? 4000);
    this.keepAlive = setInterval(() => {
      for (const res of this.clients) res.write(": keep-alive\n\n");
    }, this.options.keepAlive ?? 25_000);
  }

  private stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.keepAlive) clearInterval(this.keepAlive);
    if (this.soon) clearTimeout(this.soon);
    this.timer = this.keepAlive = this.soon = null;
    for (const w of this.watchers.values()) w.close();
    this.watchers.clear();
  }

  private send(res: http.ServerResponse, event: string, data: unknown) {
    res.write(`id: ${++this.seq}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  private broadcast(event: string, data: unknown) {
    for (const res of this.clients) this.send(res, event, data);
  }

  /** One look at every project; ticks never overlap. */
  tick(): Promise<void> {
    this.running ??= this.look().finally(() => (this.running = null));
    return this.running;
  }

  private async look() {
    const projects = this.options.projects();
    const ids = new Set(projects.map((p) => p.id));

    for (const id of [...this.statuses.keys()]) {
      if (ids.has(id)) continue;
      this.statuses.delete(id);
      this.last.delete(id);
      this.ci.delete(id);
      this.watchers.get(id)?.close();
      this.watchers.delete(id);
      this.broadcast("removed", { id });
    }

    await Promise.all(
      projects.map(async (project) => {
        if (this.options.watchGit !== false && !this.watchers.has(project.id)) this.watchGit(project);
        const status = await this.statusOf(project);
        const key = JSON.stringify(status);
        this.statuses.set(project.id, status);
        if (this.last.get(project.id) === key) return;
        this.last.set(project.id, key);
        this.broadcast("project", status);
      })
    );
  }

  private watchGit(project: GatewayProject) {
    try {
      // HEAD (branch switch), index (stage/commit), refs (commit, fetch, push).
      const w = watch(path.join(project.path, ".git"), { persistent: false }, (_event, file) => {
        if (file && /^(HEAD|index|ORIG_HEAD|FETCH_HEAD|packed-refs)$/.test(String(file))) this.poke();
      });
      w.on("error", () => w.close());
      this.watchers.set(project.id, w);
    } catch {
      // No watching on this file system: the ticks still catch it.
    }
  }

  private async statusOf(project: GatewayProject): Promise<ProjectStatus> {
    const [git, live] = await Promise.all([
      this.git(["status", "-b", "--porcelain=v1"], project.path).then(parseStatus, () => ({ branch: null, changes: 0, ahead: 0, behind: 0 })),
      project.port ? (this.read(project.port, "/api/live") as Promise<{ run?: LiveRun | null; chat?: LiveRun | null }>).catch(() => null) : null,
    ]);
    return {
      id: project.id,
      name: project.name,
      ready: project.port !== null,
      ...git,
      run: live?.run ?? null,
      chat: live?.chat ?? null,
      ci: await this.ciOf(project, git.branch),
    };
  }

  /** The newest CI build on the branch, asked of the console (which asks GitHub) now and then. */
  private async ciOf(project: GatewayProject, branch: string | null): Promise<LiveCi | null> {
    const cached = this.ci.get(project.id);
    const running = cached?.value && cached.value.status !== "completed";
    const every = running ? (this.options.ciActiveInterval ?? 15_000) : (this.options.ciInterval ?? 90_000);
    if (cached && Date.now() - cached.at < every) return cached.value;
    if (!project.port) return cached?.value ?? null;

    let value: LiveCi | null = null;
    try {
      const data = (await this.read(project.port, "/api/ci-builds")) as { runs?: { status: string; conclusion: string | null; branch: string; url: string; createdAt: string }[] | null };
      const mine = (data.runs ?? []).find((r) => r.branch === branch) ?? null;
      value = mine ? { status: mine.status, conclusion: mine.conclusion, branch: mine.branch, url: mine.url, createdAt: mine.createdAt } : null;
    } catch {
      // No CI for this project (404), or GitHub can't be asked: nothing to show.
    }
    this.ci.set(project.id, { at: Date.now(), value });
    return value;
  }
}
