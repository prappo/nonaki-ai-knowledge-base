/**
 * The Release Console's server-module API, rebuilt on release-agent + the WPSP
 * recipe and hooks. The synced console tests import from here instead of the
 * console's `server/` folder, so they exercise the generic engine unchanged.
 *
 * Everything below only translates shapes; behaviour comes from the engine,
 * `recipes/wpsp-pro.recipe.json` and `recipes/wpsp-pro.hooks.mjs`.
 */

import path from "node:path";
import {
  createContext,
  createRepoContext,
  SettingsError,
  validateSettings,
  writeSettings,
  readStoredSettings,
  resolvePath,
  type SettingIssue,
  type StoredSettings,
} from "../../src/recipe/context.ts";
import { hasLocalTag as engineHasLocalTag } from "../../src/recipe/checks.ts";
import { fetchGitHubRelease, ProbeCache, probeApi, type CommandResult as EngineCommandResult } from "../../src/recipe/hooks.ts";
import { openRecipe } from "../../src/recipe/load.ts";
import { render } from "../../src/recipe/template.ts";
import {
  localBuildChoices as engineLocalBuildChoices,
  stageStates as engineStageStates,
  type BuildRecord as EngineBuildRecord,
  type StageState as EngineStageState,
} from "../../src/recipe/stages.ts";
import {
  healthChecks as engineHealthChecks,
  latestReleaseTag as engineLatestReleaseTag,
  localSites as engineLocalSites,
  siteFor as engineSiteFor,
  type HealthCheck,
} from "../../src/health/health.ts";
import { BROWSER_SCRIPT_TOOL, createRiskAssessor, describeToolCall, splitCommand } from "../../src/runs/risk.ts";
import { setRiskAssessor } from "../../src/runs/runner.ts";

// runs/ (runner, store, transcript) are ported as-is, so the tests use them directly
export * from "../../src/runs/runner.ts";
export * from "../../src/runs/store.ts";
export * from "../../src/runs/transcript.ts";
// @ts-expect-error the hooks are plain JavaScript in the product's repo
import * as wpspHooks from "../../recipes/wpsp-pro.hooks.mjs";

export const WPSP_ROOT =
  process.env.WPSP_ROOT ?? "/Users/prince/Local Sites/wpsp/app/public/wp-content/plugins/wp-simple-pay-pro";

const opened = await openRecipe(path.join(import.meta.dirname, "../../recipes/wpsp-pro.recipe.json"));

/**
 * Stages the recipe adds on top of the console's pipeline. The console has
 * no counterpart to compare them with, so the adapter leaves them out, and
 * test/wpsp-docs-site-pr.test.ts covers them instead.
 */
export const ENGINE_ONLY_STAGES = new Set(["docs-site-pr"]);

export const recipe: typeof opened.recipe = {
  ...opened.recipe,
  stages: opened.recipe.stages.filter((s) => !ENGINE_ONLY_STAGES.has(s.id)),
  checks: opened.recipe.checks?.map((c) =>
    c.stages ? { ...c, stages: c.stages.filter((id) => !ENGINE_ONLY_STAGES.has(id)) } : c,
  ),
};
export const { hooks } = opened;

// ── version.ts ───────────────────────────────────────────────────────────

export interface ReleaseVersion {
  version: string;
  base: string;
  isHotfix: boolean;
  releaseDir: string;
  analysisFile: string;
  marketingSiteChangesFile: string;
}

export function parseVersion(input: unknown): ReleaseVersion | null {
  const ctx = createContext(recipe, "/", input, {}, { processEnv: {} });
  if (!ctx) return null;
  const v = ctx.vars;
  return {
    version: String(v.version),
    base: String(v.base),
    isHotfix: Boolean(v.hotfix),
    releaseDir: String(v.releaseDir),
    analysisFile: String(v.analysisFile),
    marketingSiteChangesFile: String(v.siteChangesFile),
  };
}

export function releaseBranches(version: ReleaseVersion): string[] {
  const check = recipe.checks!.find((c) => c.type === "gitBranch") as { expect: string[] };
  return check.expect.map((t) => render(t, { version: version.version }));
}

// ── config.ts ────────────────────────────────────────────────────────────

export const CONFIG_FILE = recipe.settings!.file;

export interface ReleaseConfig {
  marketingSitePath: string | null;
  liteRepoPath: string | null;
}

export class ConfigError extends Error {
  readonly issues: SettingIssue[];
  constructor(issues: SettingIssue[]) {
    super(issues.map((i) => i.message).join(" "));
    this.issues = issues;
  }
}

const asConfig = (s: StoredSettings): ReleaseConfig => ({
  marketingSitePath: s.marketingSitePath ?? null,
  liteRepoPath: s.liteRepoPath ?? null,
});

export const readConfig = (root: string): ReleaseConfig => asConfig(readStoredSettings(recipe, root));
export const validateConfig = (root: string, config: ReleaseConfig): SettingIssue[] => validateSettings(recipe, root, { ...config });
export const defaultLitePath = (root: string) => path.join(path.dirname(root), "wp-simple-pay-lite");
export const effectiveLitePath = (root: string, config: ReleaseConfig): string =>
  String(createRepoContext(recipe, root, { ...config }, { processEnv: {} }).vars["settings.liteRepoPath"]);
export const sessionEnv = (config: ReleaseConfig): Record<string, string> =>
  createRepoContext(recipe, "/", { ...config }, { processEnv: {} }).env;

export function writeConfig(root: string, input: Record<string, unknown>): ReleaseConfig {
  try {
    return asConfig(writeSettings(recipe, root, input));
  } catch (e) {
    if (e instanceof SettingsError) throw new ConfigError(e.issues);
    throw e;
  }
}

export function svnWorkingCopyPath(root: string, env: Record<string, string | undefined> = process.env): string {
  const ctx = createContext(recipe, root, "0.0.0", {}, { processEnv: env })!;
  return resolvePath(ctx.root, String(ctx.vars.svnPath));
}

// ── github.ts / notifications.ts ────────────────────────────────────────

export type CommandResult = EngineCommandResult;
export type CommandRunner = (command: string, args: string[], cwd: string, timeoutMs: number) => Promise<CommandResult>;

export const LITE_GITHUB_REPO = (recipe.probes!.liteRelease as { repo: string }).repo;
export const liteZipName: (version: string) => string = wpspHooks.liteZipName;

/** The console's cached `gh release view` lookups, on the engine's probe cache. */
export class GitHubReleases {
  private readonly cache: ProbeCache;
  private readonly cwd: string;
  private readonly run: CommandRunner;
  constructor(cwd: string, run: CommandRunner, ttlMs = 60_000, now: () => number = Date.now) {
    this.cwd = cwd;
    this.run = run;
    this.cache = new ProbeCache(ttlMs, now);
  }
  lookup(repo: string, tag: string) {
    return this.cache.get(`${repo}@${tag}`, () => fetchGitHubRelease(this.run, this.cwd, repo, tag)) as ReturnType<typeof fetchGitHubRelease>;
  }
  clear() {
    this.cache.clear();
  }
}

export const NOTIFICATION_FEEDS = wpspHooks.NOTIFICATION_FEEDS as { live: string; draft: string };
export interface FeedNotification {
  id: number;
  title: string;
  content: string;
  type: string[];
}
export interface NotificationFeedsSnapshot {
  live: FeedNotification[];
  draft: FeedNotification[];
}
export const releaseNotifications: (feeds: NotificationFeedsSnapshot, version: string) => { id: number; audience: "pro" | "lite"; published: boolean }[] =
  wpspHooks.releaseNotifications;

/** The console's feed reader: the WPSP probe hook behind the engine's cache. */
export class NotificationFeeds {
  private readonly cache: ProbeCache;
  private readonly fetcher: (url: string) => Promise<unknown>;
  constructor(fetcher: (url: string) => Promise<unknown> = async () => null, ttlMs = 60_000, now: () => number = Date.now) {
    this.fetcher = fetcher;
    this.cache = new ProbeCache(ttlMs, now);
  }
  lookup(): Promise<NotificationFeedsSnapshot | null> {
    const api = probeApi("/", {}, { run: async () => ({ ok: false, stdout: "", stderr: "" }), fetchJson: (url) => this.fetcher(url) });
    return this.cache.get("feeds", () => wpspHooks.notificationFeeds(api)) as Promise<NotificationFeedsSnapshot | null>;
  }
  clear() {
    this.cache.clear();
  }
}

// ── stages.ts ────────────────────────────────────────────────────────────

/** A build record as the console writes it (with its Pro/Lite flag). */
export type BuildRecord = EngineBuildRecord & { lite: boolean; steps: unknown[]; error: string | null };
export interface LocalBuildSource {
  record: BuildRecord;
  dir: string;
}

export interface StageDefinition {
  id: string;
  group: string;
  title: string;
  command: string;
  irreversible: boolean;
  browser: boolean;
  localBuild: boolean;
}

const commandOf = (prompt: string) => prompt.match(/^\/(\S+)/)![1];

export const STAGES: StageDefinition[] = recipe.stages.map((s) => ({
  id: s.id,
  group: s.group,
  title: s.title,
  command: commandOf(s.prompt),
  irreversible: s.irreversible === true,
  browser: (s.requires ?? []).includes("browser"),
  localBuild: Boolean(s.localBuild),
}));

export const findStage = (id: string) => STAGES.find((s) => s.id === id);
export const stagePrompt = (stage: StageDefinition, version: ReleaseVersion) => `/${stage.command} ${version.version}`;
export const hasLocalTag = engineHasLocalTag;
export const svnTrunkReleased: (svnPath: string, version: string) => boolean | null = wpspHooks.svnTrunkReleased;

export function marketingAssets(version: ReleaseVersion): string[] {
  const ctx = createContext(recipe, "/", version.version, {}, { processEnv: {} })!;
  const marketing = recipe.stages.find((s) => s.id === "marketing")!;
  return (marketing.doneWhen as { all: { fileExists: string }[] }).all.map((c) => render(c.fileExists, ctx.vars));
}

export interface StageContext {
  root: string;
  version: ReleaseVersion;
  litePath: string;
  svnPath?: string;
  liteRelease?: unknown;
  notificationFeeds?: unknown;
  localBuilds?: LocalBuildSource[];
}

function engineContext(ctx: StageContext) {
  return createContext(recipe, ctx.root, ctx.version.version, { liteRepoPath: ctx.litePath }, {
    processEnv: ctx.svnPath ? { SVN_WC: ctx.svnPath } : {},
  })!;
}

/** The console's choice shape: pre-quoted paths and a lite flag. */
const oldChoice = (c: ReturnType<typeof engineLocalBuildChoices>[number]) => {
  const quote = (p: string | undefined) => (p === undefined ? null : /^[\w./@+-]+$/.test(p) ? p : `'${p.replace(/'/g, `'\\''`)}'`);
  return { ...c, lite: "lite" in c.artifacts, pro: quote(c.artifacts.pro)!, liteZip: quote(c.artifacts.lite) };
};

export function localBuildChoices(stage: StageDefinition, ctx: StageContext) {
  const def = recipe.stages.find((s) => s.id === stage.id)!;
  return engineLocalBuildChoices(def, engineContext(ctx), ctx.localBuilds ?? []).map(oldChoice);
}

export function stageStates(ctx: StageContext) {
  const probes: Record<string, unknown> = {};
  if (ctx.liteRelease !== undefined) probes.liteRelease = ctx.liteRelease;
  if (ctx.notificationFeeds !== undefined) probes.notificationFeeds = ctx.notificationFeeds;

  return engineStageStates(engineContext(ctx), { builds: ctx.localBuilds ?? [], probes, hooks }).map((s: EngineStageState) => ({
    ...s,
    command: commandOf(s.prompt),
    localBuilds: s.localBuilds.map(oldChoice),
  }));
}

// ── health.ts ────────────────────────────────────────────────────────────

export interface HealthOptions {
  root: string;
  version: ReleaseVersion | null;
  run?: CommandRunner;
  localDataDir?: string;
  nvmDir?: string;
}

export async function healthChecks(options: HealthOptions): Promise<HealthCheck[]> {
  const ctx = options.version
    ? createContext(recipe, options.root, options.version.version)!
    : createRepoContext(recipe, options.root);
  return engineHealthChecks(ctx, {
    run: options.run,
    hooks,
    localDataDir: options.localDataDir,
    dirOverrides: options.nvmDir ? { node16: options.nvmDir } : {},
  });
}

export const latestReleaseTag = (tags: string[]) => engineLatestReleaseTag(tags, /^\d+\.\d+\.\d+(\.\d+)?$/);
export const localSites = (dir: string) => engineLocalSites(dir);
export const siteFor = engineSiteFor;

// ── risk.ts ──────────────────────────────────────────────────────────────

const risk = createRiskAssessor(recipe);
setRiskAssessor(risk); // the runner's approvals use the WPSP rules, as the console's do
export const assessBashRisk = risk.assessBashRisk;
export const assessBrowserScriptRisk = risk.assessBrowserScriptRisk;
export const assessToolRisk = risk.assessToolRisk;
export { BROWSER_SCRIPT_TOOL, describeToolCall, splitCommand };
