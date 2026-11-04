/**
 * Setup checks: what the release needs from this machine, as listed in the
 * recipe's `checks`. Checks never block a stage. A failed check shows on the
 * stages it affects, so the release manager can fix it before pressing Run.
 */

import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { resolvePath, validateSettings, type ReleaseContext, type RepoContext } from "../recipe/context.ts";
import { render, type Vars } from "../recipe/template.ts";
import type { HealthCheckDef, LocalWpMessages } from "../recipe/types.ts";
import { releaseChanges, STATUS_ARGS } from "../repo/git.ts";
import { defaultFetchJson, NO_HOOKS, probeApi, type Hooks } from "../recipe/hooks.ts";

export type CheckStatus = "ok" | "warn" | "fail" | "info";

export interface HealthCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  /** Stage ids that need this check to pass (none for informational results). */
  stages: string[];
}

export interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (command: string, args: string[], cwd: string, timeoutMs: number) => Promise<CommandResult>;

export const runCommand: CommandRunner = (command, args, cwd, timeoutMs) =>
  new Promise((resolve) => {
    execFile(command, args, { cwd, timeout: timeoutMs, encoding: "utf8" }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout: String(stdout ?? ""), stderr: String(stderr ?? error?.message ?? "") });
    });
  });

export interface HealthOptions {
  run?: CommandRunner;
  hooks?: Hooks;
  fetchJson?: (url: string, timeoutMs: number) => Promise<unknown>;
  /** Replace a dirEntry check's folder, by check id. Injectable for tests. */
  dirOverrides?: Record<string, string>;
  /** Local by Flywheel's data folder (defaults per platform). Injectable for tests. */
  localDataDir?: string;
  /** Home folder for `~` in recipe paths. Injectable for tests. */
  home?: string;
}

// ── Local by Flywheel ───────────────────────────────────────────────────

export interface LocalSite {
  id: string;
  name: string;
  path: string;
}

export function defaultLocalDataDir(home = homedir()): string {
  if (process.platform === "darwin") return path.join(home, "Library/Application Support/Local");
  if (process.platform === "win32") return path.join(process.env.APPDATA ?? path.join(home, "AppData/Roaming"), "Local");
  return path.join(home, ".config/Local");
}

const expandHomeIn = (value: string, home: string) =>
  value === "~" || value.startsWith("~/") ? path.join(home, value.slice(1)) : value;

export function localSites(localDataDir: string, home = homedir()): LocalSite[] {
  try {
    const data = JSON.parse(readFileSync(path.join(localDataDir, "sites.json"), "utf8")) as Record<string, { name?: string; path?: string }>;
    return Object.entries(data)
      .filter(([, site]) => typeof site?.path === "string")
      .map(([id, site]) => ({ id, name: String(site.name ?? id), path: path.resolve(expandHomeIn(site.path!, home)) }));
  } catch {
    return [];
  }
}

/** The Local site whose folder contains `target`, if any. */
export function siteFor(sites: LocalSite[], target: string): LocalSite | null {
  const resolved = path.resolve(target);
  return sites.find((site) => resolved === site.path || resolved.startsWith(site.path + path.sep)) ?? null;
}

/** Local has no CLI; a site is running when its MySQL socket exists. */
export function isSiteRunning(localDataDir: string, site: LocalSite): boolean {
  return existsSync(path.join(localDataDir, "run", site.id, "mysql", "mysqld.sock"));
}

// ── tags ────────────────────────────────────────────────────────────────

/** The highest tag matching `pattern`, comparing dot-separated numbers. */
export function latestReleaseTag(tags: string[], pattern: RegExp): string | null {
  // compare the numeric parts, ignoring a non-numeric prefix such as "v"
  const parts = (tag: string) => tag.replace(/^\D+/, "").split(".").map((p) => parseInt(p, 10) || 0);
  return (
    tags
      .filter((tag) => pattern.test(tag))
      .sort((a, b) => {
        const [x, y] = [parts(a), parts(b)];
        for (let i = 0; i < Math.max(x.length, y.length); i++) {
          const d = (y[i] ?? 0) - (x[i] ?? 0);
          if (d !== 0) return d;
        }
        return 0;
      })[0] ?? null
  );
}

// ── evaluation ──────────────────────────────────────────────────────────

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

interface Env {
  ctx: RepoContext;
  version: string | null;
  run: CommandRunner;
  localDataDir: string;
  home: string;
  hooks: Hooks;
  fetchJson: (url: string, timeoutMs: number) => Promise<unknown>;
  dirOverrides: Record<string, string>;
}

function localWp(
  env: Env,
  target: string,
  messages: LocalWpMessages,
  vars: Vars
): { status: CheckStatus; detail: string } {
  const site = siteFor(localSites(env.localDataDir, env.home), target);
  if (!site) {
    return { status: "warn", detail: render(messages.notFound ?? "This checkout is not inside a Local by Flywheel site.", vars) };
  }
  const v = { ...vars, site: site.name };
  return isSiteRunning(env.localDataDir, site)
    ? { status: "ok", detail: render(messages.running ?? "{site} is running.", v) }
    : { status: "fail", detail: render(messages.stopped ?? "{site} is stopped. Start it in Local.", v) };
}

async function evaluateCheck(def: HealthCheckDef, env: Env): Promise<HealthCheck | null> {
  const { ctx, run } = env;
  const stages = def.stages ?? [];
  const stage = def.stageName ?? ctx.recipe.stages.find((s) => s.id === stages[0])?.title ?? "The release";
  const vars: Vars = { ...ctx.vars, stage };
  const result = (status: CheckStatus, detail: string): HealthCheck => ({
    id: def.id,
    label: def.label,
    status,
    detail,
    stages: status === "info" ? [] : stages,
  });

  switch (def.type) {
    case "gitBranch": {
      if (!env.version) return null; // nothing to compare against yet
      const out = await run("git", ["rev-parse", "--abbrev-ref", "HEAD"], ctx.root, 5000);
      const current = out.stdout.trim();
      const expected = def.expect.map((t) => render(t, vars));
      return expected.includes(current)
        ? result("ok", `On ${current}.`)
        : result("warn", `On ${current || "an unknown branch"}, not ${expected.join(" or ")}. ${stage} reads the current branch.`);
    }

    case "previousTag": {
      const out = await run("git", ["tag", "--sort=-v:refname"], ctx.root, 5000);
      const tags = out.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
      const pattern = new RegExp(def.tagPattern);
      const latest = latestReleaseTag(tags, pattern);
      const first = tags[0];
      if (!latest) return result("warn", `No release tags found, so ${stage} has nothing to compare against.`);
      if (first && first !== latest && !pattern.test(first)) {
        return result(
          "warn",
          `Latest release tag is ${latest}, but \`git tag --sort=-v:refname\` lists ${first} first. Make sure ${stage} compares against ${latest}.`
        );
      }
      return result("info", `Latest release tag is ${latest}.`);
    }

    case "workingTree": {
      const out = await run("git", STATUS_ARGS, ctx.root, 10000);
      const n = releaseChanges(out.stdout, ctx.recipe.reset?.hide ?? []).changes.length;
      return result("info", n ? `${plural(n, "uncommitted change")}.` : "Clean.");
    }

    case "command": {
      const [cmd, ...args] = def.run;
      const out = await run(cmd, args, ctx.root, 10000);
      if (out.ok) {
        const match = def.capture ? new RegExp(def.capture).exec(out.stdout + out.stderr)?.[1] : undefined;
        if (match === undefined && def.okDetailFallback) return result("ok", render(def.okDetailFallback, vars));
        return result("ok", render(def.okDetail, { ...vars, match: match ?? "" }));
      }
      const missing = /ENOENT|not found/i.test(out.stderr);
      return result(def.failLevel ?? "fail", render(missing && def.missingDetail ? def.missingDetail : def.failDetail, vars));
    }

    case "dockerContainer": {
      const out = await run("docker", ["ps", "--format", "{{.Names}}"], ctx.root, 5000);
      if (!out.ok) return result("warn", render(def.dockerDownDetail, vars));
      const pattern = new RegExp(def.namePattern);
      const running = out.stdout.split("\n").some((name) => pattern.test(name.trim()));
      return running ? result("ok", render(def.okDetail, vars)) : result("warn", render(def.failDetail, vars));
    }

    case "dirEntry": {
      const dir = env.dirOverrides[def.id] ?? expandHomeIn(render(def.dir, vars), env.home);
      let entries: string[] = [];
      try {
        entries = readdirSync(dir).filter((name) => name.startsWith(def.prefix));
      } catch {
        entries = [];
      }
      return entries.length
        ? result("ok", render(def.okDetail, { ...vars, dir, match: entries.sort().pop()! }))
        : result("warn", render(def.failDetail, { ...vars, dir }));
    }

    case "setting": {
      const issue = validateSettings(ctx.recipe, ctx.root, ctx.stored).find((i) => i.field === def.field);
      if (issue) return result(issue.level === "error" ? "fail" : "warn", `${issue.message}${def.issueHint ?? ""}`);
      const value = String(ctx.vars[`settings.${def.field}`] ?? "");
      if (def.localWpSite) {
        const r = localWp(env, value, def.localWpSite, vars);
        return result(r.status, r.detail);
      }
      return result("ok", value);
    }

    case "script": {
      const hook = env.hooks.health.get(def.id);
      if (!hook) throw new Error(`Check "${def.id}" names hook ${def.hook}, but hooks weren't loaded`);
      try {
        const r = await hook({ ...probeApi(ctx.root, vars, { run, fetchJson: env.fetchJson }), stage });
        return result(r.status, r.detail);
      } catch (e) {
        return result("warn", `Could not run this check: ${(e as Error).message}`);
      }
    }

    case "localWpSite": {
      const target = render(def.path, vars);
      if (!target) return result("warn", "No path to check.");
      const r = localWp(env, resolvePath(ctx.root, target), def, vars);
      return result(r.status, r.detail);
    }
  }
}

/**
 * Run every setup check in recipe order. Pass a ReleaseContext to include the
 * version-dependent ones (the branch check).
 */
export async function healthChecks(ctx: RepoContext | ReleaseContext, options: HealthOptions = {}): Promise<HealthCheck[]> {
  const home = options.home ?? homedir();
  const env: Env = {
    ctx,
    version: "version" in ctx ? ctx.version : null,
    run: options.run ?? runCommand,
    localDataDir: options.localDataDir ?? defaultLocalDataDir(home),
    home,
    hooks: options.hooks ?? NO_HOOKS,
    fetchJson: options.fetchJson ?? defaultFetchJson,
    dirOverrides: options.dirOverrides ?? {},
  };
  const results = await Promise.all((ctx.recipe.checks ?? []).map((def) => evaluateCheck(def, env)));
  return results.filter((r): r is HealthCheck => r !== null);
}
