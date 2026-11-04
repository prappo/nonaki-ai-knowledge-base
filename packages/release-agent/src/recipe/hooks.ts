/**
 * Hooks: product-specific JavaScript next to the recipe (`"<module>#<export>"`).
 *
 *   status hooks  sync    (StatusApi) => StatusOverride      stage `status`
 *   probe hooks   async   (ProbeApi)  => unknown | null      `probes.<name>` of type "script"
 *   health hooks  async   (HealthApi) => { status, detail }  checks of type "script"
 *
 * Hooks are loaded once with the recipe. They run on the agent, with the same
 * trust as the repo's own release commands.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { hasLocalTag } from "./checks.ts";
import { resolvePath } from "./context.ts";
import { render, type Vars } from "./template.ts";
import type { HookRef, Recipe, StageRemote } from "./types.ts";

// ── APIs given to hooks ─────────────────────────────────────────────────

export interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (command: string, args: string[], cwd: string, timeoutMs: number) => Promise<CommandResult>;

export interface SyncResult {
  ok: boolean;
  /** Exit status, or null when the program couldn't start. */
  status: number | null;
  stdout: string;
  stderr: string;
}

interface BaseApi {
  vars: Vars;
  root: string;
  /** A recipe path: relative to the repo unless absolute (`~` expanded). */
  resolve(p: string): string;
  fileExists(p: string): boolean;
  readFile(p: string): string | null;
  hasLocalTag(repo: string, tag: string): boolean;
  render(template: string, escape?: "none" | "regex" | "arg"): string;
}

export interface StatusApi extends BaseApi {
  /** Probe results: undefined = not looked up, null = lookup failed. */
  probes: Record<string, unknown>;
  /** What the declarative recipe fields decided. */
  declared: { done: boolean | null; blockedReason: string | null };
  /** Run a program without a shell (for offline checks such as `svn status`). */
  runSync(command: string, args: string[], timeoutMs?: number): SyncResult;
}

export interface StatusOverride {
  done?: boolean | null;
  blockedReason?: string | null;
  remote?: StageRemote | null;
}

export interface ProbeApi extends BaseApi {
  run(command: string, args: string[], timeoutMs?: number): Promise<CommandResult>;
  fetchJson(url: string, timeoutMs?: number): Promise<unknown>;
}

export interface HealthApi extends ProbeApi {
  /** `stageName`, else the title of the check's first stage. */
  stage: string;
}

export type StatusHook = (api: StatusApi) => StatusOverride | null | undefined;
export type ProbeHook = (api: ProbeApi) => Promise<unknown>;
export type HealthHook = (api: HealthApi) => Promise<{ status: "ok" | "warn" | "fail" | "info"; detail: string }>;

export interface Hooks {
  status: Map<string, StatusHook>;
  probes: Map<string, ProbeHook>;
  health: Map<string, HealthHook>;
}

export const NO_HOOKS: Hooks = { status: new Map(), probes: new Map(), health: new Map() };

export class HookError extends Error {}

function baseApi(root: string, vars: Vars): BaseApi {
  const resolve = (p: string) => resolvePath(root, p);
  return {
    vars,
    root,
    resolve,
    fileExists: (p) => existsSync(resolve(p)),
    readFile: (p) => {
      try {
        return readFileSync(resolve(p), "utf8");
      } catch {
        return null;
      }
    },
    hasLocalTag: (repo, tag) => hasLocalTag(resolve(repo), tag),
    render: (t, escape = "none") => render(t, vars, escape),
  };
}

export function statusApi(root: string, vars: Vars, probes: Record<string, unknown>, declared: StatusApi["declared"]): StatusApi {
  return {
    ...baseApi(root, vars),
    probes,
    declared,
    runSync(command, args, timeoutMs = 5000) {
      const r = spawnSync(command, args, { cwd: root, encoding: "utf8", timeout: timeoutMs });
      return { ok: !r.error && r.status === 0, status: r.error ? null : r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? String(r.error ?? "") };
    },
  };
}

export interface RemoteDeps {
  run: CommandRunner;
  fetchJson: (url: string, timeoutMs: number) => Promise<unknown>;
}

export const defaultFetchJson = async (url: string, timeoutMs: number): Promise<unknown> => {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { "Cache-Control": "no-cache" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
};

export function probeApi(root: string, vars: Vars, deps: RemoteDeps): ProbeApi {
  return {
    ...baseApi(root, vars),
    run: (command, args, timeoutMs = 15000) => deps.run(command, args, root, timeoutMs),
    fetchJson: (url, timeoutMs = 15000) => deps.fetchJson(url, timeoutMs),
  };
}

// ── loading ─────────────────────────────────────────────────────────────

function hookRefs(recipe: Recipe): { kind: keyof Hooks; key: string; ref: HookRef }[] {
  return [
    ...recipe.stages.flatMap((s) => (s.status ? [{ kind: "status" as const, key: s.id, ref: s.status }] : [])),
    ...Object.entries(recipe.probes ?? {}).flatMap(([name, p]) => (p.type === "script" ? [{ kind: "probes" as const, key: name, ref: p.hook }] : [])),
    ...(recipe.checks ?? []).flatMap((c) => (c.type === "script" ? [{ kind: "health" as const, key: c.id, ref: c.hook }] : [])),
  ];
}

/** Import every hook a recipe names, from the folder holding the recipe file. */
export async function loadHooks(recipe: Recipe, recipeDir: string): Promise<Hooks> {
  const hooks: Hooks = { status: new Map(), probes: new Map(), health: new Map() };
  const modules = new Map<string, Record<string, unknown>>();
  const base = path.resolve(recipeDir);

  for (const { kind, key, ref } of hookRefs(recipe)) {
    const [file, name] = ref.split("#");
    const full = path.resolve(base, file);
    if (!full.startsWith(base + path.sep)) throw new HookError(`${ref}: hooks must live inside ${base}`);
    if (!modules.has(full)) {
      try {
        modules.set(full, (await import(pathToFileURL(full).href)) as Record<string, unknown>);
      } catch (e) {
        throw new HookError(`${ref}: could not load ${full} (${(e as Error).message})`);
      }
    }
    const fn = modules.get(full)![name];
    if (typeof fn !== "function") throw new HookError(`${ref}: ${file} has no exported function "${name}"`);
    (hooks[kind] as Map<string, unknown>).set(key, fn);
  }
  return hooks;
}

// ── probes ──────────────────────────────────────────────────────────────

/**
 * Short-lived cache for remote lookups. A failed lookup (null) is not kept,
 * so the next refresh tries again. `clear()` after a run that may have
 * published.
 */
export class ProbeCache {
  private readonly entries = new Map<string, { at: number; value: Promise<unknown> }>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(ttlMs = 60_000, now: () => number = Date.now) {
    this.ttlMs = ttlMs;
    this.now = now;
  }

  get(key: string, load: () => Promise<unknown>): Promise<unknown> {
    const cached = this.entries.get(key);
    if (cached && this.now() - cached.at < this.ttlMs) return cached.value;

    // a loader that throws counts as a failed lookup, so nothing rejects unhandled
    const value = load().catch(() => null);
    const entry = { at: this.now(), value };
    this.entries.set(key, entry);
    void value.then((v) => {
      if (v === null && this.entries.get(key) === entry) this.entries.delete(key);
    });
    return value;
  }

  clear(): void {
    this.entries.clear();
  }
}

/** A GitHub release, or `{ exists: false }` when there's none for the tag. */
export type GitHubRelease =
  | { exists: true; tag: string; url: string; publishedAt: string | null; isDraft: boolean; assets: string[] }
  | { exists: false; tag: string };

/** `gh release view`. Null when GitHub couldn't be asked (no gh, no network, bad output). */
export async function fetchGitHubRelease(run: CommandRunner, cwd: string, repo: string, tag: string): Promise<GitHubRelease | null> {
  const result = await run("gh", ["release", "view", tag, "--repo", repo, "--json", "tagName,url,publishedAt,isDraft,assets"], cwd, 15000);
  if (!result.ok) return /release not found/i.test(result.stderr) ? { exists: false, tag } : null;
  try {
    const data = JSON.parse(result.stdout) as {
      tagName?: string;
      url?: string;
      publishedAt?: string | null;
      isDraft?: boolean;
      assets?: { name?: string }[];
    };
    return {
      exists: true,
      tag: data.tagName ?? tag,
      url: data.url ?? "",
      publishedAt: data.publishedAt || null,
      isDraft: data.isDraft === true,
      assets: (data.assets ?? []).map((a) => a.name ?? "").filter(Boolean),
    };
  } catch {
    return null;
  }
}

/** Run every probe (through the cache). Values: the result, or null when it failed. */
export async function resolveProbes(
  recipe: Recipe,
  hooks: Hooks,
  root: string,
  vars: Vars,
  cache: ProbeCache,
  deps: RemoteDeps
): Promise<Record<string, unknown>> {
  const entries = await Promise.all(
    Object.entries(recipe.probes ?? {}).map(async ([name, def]) => {
      if (def.type === "githubRelease") {
        const repo = render(def.repo, vars);
        const tag = render(def.tag, vars);
        return [name, await cache.get(`github:${repo}@${tag}`, () => fetchGitHubRelease(deps.run, root, repo, tag))] as const;
      }
      const hook = hooks.probes.get(name);
      if (!hook) return [name, null] as const;
      const key = `script:${name}:${String(vars.version ?? "")}`;
      return [name, await cache.get(key, async () => (await hook(probeApi(root, vars, deps))) ?? null)] as const;
    })
  );
  return Object.fromEntries(entries);
}
