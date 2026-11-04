/**
 * Release recipe format.
 *
 * A recipe is a JSON file in the product's repo (`.release/recipe.json`) that
 * describes its release pipeline as data: which command each stage runs, how
 * to tell from disk whether it already ran, what blocks it, and what the
 * machine needs. The engine knows nothing about any one product.
 *
 * Templates
 * ---------
 * Any string marked `Template` may reference variables as `{name}` or
 * `{namespace.name}`. `{{` and `}}` are literal braces. A `{` followed by a
 * digit (as in the regex `\d{2}`) is left alone. Variables:
 *
 *   {version}             the version as entered
 *   {<group>}             each named group of `version.pattern`
 *   {<var>}               each entry of `vars` (repo-level: may use settings and env),
 *                         then of `version.vars` (may use all of the above), in order
 *   {repo} {repoParent}   the repo root and its parent folder (absolute)
 *   {settings.<field>}    a Setting's value, or its default
 *   {env.<NAME>}          an environment variable on the agent's machine ("" when unset)
 *   {build.*}             only inside `localBuild.args` (see LocalBuildDef)
 *
 * Inside `regex` fields every value is regex-escaped, and inside
 * `localBuild.args` every value is quoted for a shell-style prompt when it
 * needs it, so a version or path can never change the pattern or the command.
 *
 * Relative paths resolve against the repo root; absolute paths (for example
 * a `{settings.…}` folder) are used as they are.
 */

export type Template = string;

/** A value chosen by whether a variable is set (non-empty, non-zero, true). */
export type Conditional<T> = T | { if: string; then: T; else?: T };

// ── checks (status from disk) ───────────────────────────────────────────

export type Check =
  | { fileExists: Template }
  /** File content matches `regex` (multiline). */
  | { fileMatches: Template; regex: Template; flags?: string }
  /** A local git tag, read from `.git` (loose or packed). `repo` defaults to the repo root. */
  | { gitTag: Template; repo?: Template }
  | { all: Check[] }
  | { any: Check[] }
  | { not: Check };

/** A stage is blocked until `check` passes; `reason` says why. */
export interface Requirement {
  check: Check;
  reason: Template;
}

// ── stages ──────────────────────────────────────────────────────────────

export type Review =
  | { type: "file"; path: Template; label: string }
  | { type: "files"; label: string }
  | { type: "docs"; label: string }
  | { type: "changes"; label: string };

/**
 * A stage that can run against a local build instead of a CI one. One choice
 * is offered per finished build that still has `requireArtifact` on disk.
 * `args` are appended to the prompt, skipping conditionals whose variable is
 * unset. Variables: {build.id} {build.commit} {build.branch} {build.changes}
 * {build.version} and {build.artifact.<kind>} (the zip's path, relative to the
 * repo when inside it; set only when that zip still exists).
 */
export interface LocalBuildDef {
  requireArtifact: string;
  args: Conditional<Template>[];
}

/**
 * A hook: `"<module>#<export>"`, a JavaScript module next to the recipe file
 * (relative path, no `..`) and the function it exports. Hooks hold the
 * product-specific logic that doesn't fit declarative checks.
 */
export type HookRef = string;

/**
 * A remote lookup several stages share. Probes run before stage status is
 * computed, are cached briefly, and report `null` when the lookup failed so
 * stages can fall back to what disk shows.
 */
export type ProbeDef =
  /** `gh release view <tag> --repo <repo>`: the release, or { exists: false }. */
  | { type: "githubRelease"; repo: Template; tag: Template }
  /** An async hook returning any JSON-able value (null = failed). */
  | { type: "script"; hook: HookRef };

/** What a remote already has for a stage (shown on its card). */
export interface StageRemote {
  tone: "success" | "warning";
  text: string;
  url: string | null;
  /** Shown, with a confirm, before running a stage that is already done. */
  rerunWarning: string | null;
}

export interface StageDef {
  id: string;
  /** Id of an entry in `groups`. */
  group: string;
  title: string;
  /** The prompt that starts the session, exactly as typed in a terminal. */
  prompt: Template;
  summary: string;
  /** The questions the command is known to stop and ask (shown on the card). */
  gates?: string[];
  /** Permanent and public: starting it needs the version typed in. Never part of Run all. */
  irreversible?: boolean;
  /**
   * What the agent machine needs, matched against its capabilities.
   * "browser" also starts the session with Claude in Chrome.
   */
  requires?: string[];
  /** When disk shows the stage done. Omitted = not tracked. */
  doneWhen?: Check;
  /** Report which `fileExists` checks inside `doneWhen` fail (file names). */
  listMissing?: boolean;
  /** Blocked until each requirement passes, first failure wins. */
  blockedUntil?: Requirement[];
  review?: Review;
  localBuild?: LocalBuildDef;
  /**
   * Sync hook given the probe results and the declarative outcome; returns
   * any of { done, blockedReason, remote } to override them.
   */
  status?: HookRef;
}

// ── settings (per-machine, stored in the repo, gitignored) ───────────────

export type SettingRule =
  /** Fails when the value is empty. */
  | { rule: "required"; level: IssueLevel; message: Template }
  | { rule: "isDirectory"; level: IssueLevel; message: Template }
  /** Fails when any listed path is missing inside the value's folder. */
  | { rule: "contains"; paths: string[]; level: IssueLevel; message: Template }
  /** Fails when the value resolves to the same folder as `path`. */
  | { rule: "notSamePath"; path: Template; level: IssueLevel; message: Template };

export type IssueLevel = "error" | "warning";

export interface SettingDef {
  label: string;
  help?: string;
  type: "path";
  /** Used when the setting is empty. Template; may use {repo} and {repoParent}. */
  default?: Template;
  /** Env var for sessions, set only when the user set a value (not the default). */
  env?: string;
  /** Checked in order against the effective value; the first failing rule is reported. */
  validate?: SettingRule[];
}

export interface SettingsDef {
  /** JSON file the values are stored in, relative to the repo. Commands may read it too. */
  file: string;
  fields: Record<string, SettingDef>;
}

// ── setup checks (machine health) ───────────────────────────────────────

interface HealthBase {
  id: string;
  label: string;
  /**
   * Stage ids a problem affects (shown on those cards). Nothing is blocked.
   * Messages may use {stage}: `stageName`, else the title of the first one.
   */
  stages?: string[];
  stageName?: string;
}

/** Messages for a Local by Flywheel site check. {site} is the site's name. */
export interface LocalWpMessages {
  /** No Local site contains the path (warn). */
  notFound?: Template;
  /** The site is stopped (fail). */
  stopped?: Template;
  /** The site is running (ok). */
  running?: Template;
}

export type HealthCheckDef =
  | (HealthBase & { type: "gitBranch"; expect: Template[] })
  | (HealthBase & { type: "previousTag"; tagPattern: string })
  | (HealthBase & { type: "workingTree" })
  | (HealthBase & {
      type: "command";
      run: string[];
      /** Regex over stdout+stderr; group 1 is available as {match} in okDetail. */
      capture?: string;
      okDetail: Template;
      /** okDetail when `capture` finds nothing. */
      okDetailFallback?: Template;
      failDetail: Template;
      /** Shown when the program isn't installed. */
      missingDetail?: Template;
      failLevel?: "fail" | "warn";
    })
  | (HealthBase & {
      type: "setting";
      field: string;
      /** Appended to a validation message, e.g. " Set it in Settings." */
      issueHint?: string;
      /** Once valid, also require the Local site holding the path to be running. */
      localWpSite?: LocalWpMessages;
    })
  | (HealthBase & {
      type: "dockerContainer";
      namePattern: string;
      okDetail: Template;
      failDetail: Template;
      dockerDownDetail: Template;
    })
  /** A folder has an entry starting with `prefix`. Messages may use {dir} and {match}. */
  | (HealthBase & {
      type: "dirEntry";
      dir: Template;
      prefix: string;
      okDetail: Template;
      failDetail: Template;
    })
  /** Local by Flywheel site containing `path` is running (WordPress tooling). */
  | (HealthBase & { type: "localWpSite"; path: Template } & LocalWpMessages)
  /** An async hook returning { status, detail }. */
  | (HealthBase & { type: "script"; hook: HookRef });

// ── outputs, reset, risk, build ─────────────────────────────────────────

export interface OutputGroupDef {
  id: string;
  title: string;
  /** What to call images folded under the group's articles. */
  mediaLabel?: string;
  /** Regexes over the lower-cased path inside `outputs.dir`; first matching group wins. */
  match: string[];
  /** Sort first within the group (priority 0), then `secondary` (1), then the rest. */
  main?: string[];
  secondary?: string[];
}

export interface OutputsDef {
  dir: Template;
  /** A folder of customer docs the release updates (shown in the Library), if the product has one. */
  docsDir?: string;
  groups: OutputGroupDef[];
  /** Group id for unmatched images, and for everything else. */
  fallback: { image: string; other: string };
}

export interface ResetDef {
  /** Regexes over repo paths: changes here are pre-ticked for discard. */
  preselect: string[];
  /** Exact paths holding the release tooling's own setup: never pre-ticked. */
  protect: string[];
  /** Folders hidden from Changes and Reset (the tooling itself). */
  hide?: string[];
}

export interface RiskRuleDef {
  rule: string;
  /** Regex over one shell command segment. */
  match: string;
  reason: string;
  irreversible?: boolean;
  /** Insert before this built-in rule (the first matching rule's reason is shown). Default: last. */
  before?: string;
}

export interface RiskDef {
  extra?: RiskRuleDef[];
  /** Replace a built-in rule's reason, keyed by rule id (e.g. "browser-write"). */
  messages?: Record<string, string>;
  /** Extra regexes a built-in Bash rule also matches, keyed by rule id. */
  alsoMatch?: Record<string, string[]>;
}

export interface BuildDef {
  /** Script run from the repo root, with BUILD_DIR set to the build's folder. */
  script: string;
  /** Artifact kinds the script produces, e.g. pro / lite; `match` (regex) recognises a zip by name. */
  artifacts: { kind: string; label: string; match?: string }[];
  /** GitHub Actions workflow file that builds the release on CI (for the Builds page). */
  ciWorkflow?: string;
  /** Folders kept out of the build's copy of the working tree. */
  exclude?: string[];
}

// ── the recipe ──────────────────────────────────────────────────────────

export interface BrandDef {
  /** Short product name for the console's header (defaults to `name`). */
  name?: string;
  /** The product's mark as SVG path data in a 60×41 box, shown white on `color`. */
  mark?: string;
  /** The mark's background colour (hex). */
  color?: string;
}

export interface Recipe {
  /** Format version of this file. */
  recipe: 1;
  name: string;
  brand?: BrandDef;
  /**
   * Folder (relative to the repo) where the console keeps run history, builds
   * and its cache — set it to share them with a console the repo already
   * runs. Default: the agent's own folder (~/.release-agent/repos/<id>).
   */
  consoleState?: string;
  version: {
    /** Anchored regex; named groups become variables. */
    pattern: string;
    /** Shown when a version is rejected, e.g. "4.17.5 or a 4-part hotfix like 4.17.4.1". */
    hint?: string;
    vars?: Record<string, Conditional<Template>>;
  };
  groups: { id: string; label: string }[];
  /** Variables that don't depend on the version (paths to sibling checkouts, …). */
  vars?: Record<string, Conditional<Template>>;
  stages: StageDef[];
  probes?: Record<string, ProbeDef>;
  settings?: SettingsDef;
  checks?: HealthCheckDef[];
  outputs?: OutputsDef;
  reset?: ResetDef;
  risk?: RiskDef;
  build?: BuildDef;
}
