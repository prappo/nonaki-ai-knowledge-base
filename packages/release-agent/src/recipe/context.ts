/**
 * Turns a recipe + repo + version into the variables every template sees.
 */

import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { isSet, pick, render, type Vars } from "./template.ts";
import type { IssueLevel, Recipe, SettingDef } from "./types.ts";

/** A repo with its settings resolved, before any version is chosen. */
export interface RepoContext {
  recipe: Recipe;
  /** Absolute repo root. */
  root: string;
  /** repo, repoParent and settings.* (no version variables). */
  vars: Vars;
  /** Env vars for sessions (settings the user set explicitly). */
  env: Record<string, string>;
  stored: StoredSettings;
}

export interface ReleaseContext extends RepoContext {
  version: string;
}

/**
 * Engine-level guard on top of the recipe's own pattern: a version ends up in
 * prompts and paths, so it may only hold version-ish characters.
 */
const SAFE_VERSION = /^[0-9A-Za-z][0-9A-Za-z.+_-]*$/;

/** Blank repo/settings variables, for checking a version without a repo. */
function blankBase(recipe: Recipe): Vars {
  const base: Vars = { repo: "", repoParent: "" };
  for (const field of Object.keys(recipe.settings?.fields ?? {})) base[`settings.${field}`] = "";
  for (const name of envNames(recipe)) base[`env.${name}`] = "";
  for (const name of Object.keys(recipe.vars ?? {})) base[name] = "";
  return base;
}

/** Parse a version against the recipe. Returns its variables, or null when invalid. */
export function parseVersion(recipe: Recipe, input: unknown, base: Vars = blankBase(recipe)): Vars | null {
  if (typeof input !== "string") return null;
  const version = input.trim();
  if (!SAFE_VERSION.test(version) || version.includes("..")) return null;
  const match = new RegExp(recipe.version.pattern).exec(version);
  if (!match || match[0] !== version) return null;

  const vars: Vars = { ...base, version };
  for (const [name, value] of Object.entries(match.groups ?? {})) vars[name] = value ?? "";
  for (const [name, value] of Object.entries(recipe.version.vars ?? {})) {
    const chosen = pick(value, vars);
    vars[name] = chosen === undefined ? "" : render(chosen, vars);
  }
  return vars;
}

export function expandHome(value: string): string {
  return value === "~" || value.startsWith("~/") ? path.join(homedir(), value.slice(1)) : value;
}

/** A recipe path: relative to the repo root unless absolute. */
export function resolvePath(root: string, rendered: string): string {
  return path.resolve(root, expandHome(rendered));
}

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function samePath(a: string, b: string): boolean {
  const real = (p: string) => {
    try {
      return realpathSync(p);
    } catch {
      return path.resolve(p);
    }
  };
  return real(a) === real(b);
}

// ── settings ────────────────────────────────────────────────────────────

export type StoredSettings = Record<string, string | null | undefined>;

export interface SettingIssue {
  field: string;
  level: IssueLevel;
  message: string;
}

const cleanValue = (v: unknown, root: string) => (typeof v === "string" && v.trim() ? resolvePath(root, v.trim()) : null);

/**
 * Read the settings file: every field, as an absolute path or null (blank,
 * missing or not a string). A missing or corrupt file reads as all null.
 */
export function readStoredSettings(recipe: Recipe, root: string): StoredSettings {
  const fields = Object.keys(recipe.settings?.fields ?? {});
  let raw: Record<string, unknown> = {};
  if (recipe.settings) {
    try {
      const parsed = JSON.parse(readFileSync(path.join(root, recipe.settings.file), "utf8")) as unknown;
      if (parsed && typeof parsed === "object") raw = parsed as Record<string, unknown>;
    } catch {
      raw = {};
    }
  }
  return Object.fromEntries(fields.map((k) => [k, cleanValue(raw[k], root)]));
}

export class SettingsError extends Error {
  readonly issues: SettingIssue[];
  constructor(issues: SettingIssue[]) {
    super(issues.map((i) => i.message).join(" "));
    this.issues = issues;
  }
}

/**
 * Save settings (cleaned: trimmed, `~` expanded, absolute; blank → null).
 * Throws a SettingsError and writes nothing when any field has an error.
 */
export function writeSettings(recipe: Recipe, root: string, input: Record<string, unknown>): StoredSettings {
  if (!recipe.settings) throw new SettingsError([]);
  const absRoot = path.resolve(root);
  const values: StoredSettings = Object.fromEntries(
    Object.keys(recipe.settings.fields).map((k) => [k, cleanValue(input[k], absRoot)])
  );
  const errors = validateSettings(recipe, absRoot, values).filter((i) => i.level === "error");
  if (errors.length) throw new SettingsError(errors);

  const file = path.join(absRoot, recipe.settings.file);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, `${JSON.stringify(values, null, "\t")}\n`);
  renameSync(`${file}.tmp`, file);
  return values;
}

/** Effective value: what the user set, else the default, else null. */
function effective(def: SettingDef, stored: string | null, base: Vars, root: string): string | null {
  if (stored) return stored;
  return def.default ? resolvePath(root, render(def.default, base)) : null;
}

export function validateSettings(recipe: Recipe, root: string, stored: StoredSettings): SettingIssue[] {
  const base: Vars = { repo: root, repoParent: path.dirname(root) };
  const issues: SettingIssue[] = [];
  for (const [field, def] of Object.entries(recipe.settings?.fields ?? {})) {
    const value = effective(def, cleanValue(stored[field], root), base, root);
    const vars = { ...base, value: value ?? "" };
    for (const rule of def.validate ?? []) {
      let ok = true;
      if (rule.rule === "required") ok = Boolean(value);
      else if (!value) continue; // the remaining rules only apply to a value
      else if (rule.rule === "isDirectory") ok = isDirectory(value);
      else if (rule.rule === "contains") ok = rule.paths.every((p) => existsSync(path.join(value, p)));
      else if (rule.rule === "notSamePath") ok = !samePath(value, resolvePath(root, render(rule.path, base)));
      if (!ok) {
        issues.push({ field, level: rule.level, message: render(rule.message, vars) });
        break;
      }
    }
  }
  return issues;
}

// ── context ─────────────────────────────────────────────────────────────

export interface ContextOptions {
  /** The agent machine's environment, for {env.*} (defaults to process.env). */
  processEnv?: Record<string, string | undefined>;
}

/** Env var names a recipe references ({env.X} or `"if": "env.X"`). */
function envNames(recipe: Recipe): string[] {
  return [...new Set([...JSON.stringify(recipe).matchAll(/\benv\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]))];
}

export function createRepoContext(
  recipe: Recipe,
  root: string,
  stored: StoredSettings = readStoredSettings(recipe, root),
  options: ContextOptions = {}
): RepoContext {
  const absRoot = path.resolve(root);
  const vars: Vars = { repo: absRoot, repoParent: path.dirname(absRoot) };
  const env: Record<string, string> = {};
  const processEnv = options.processEnv ?? process.env;
  // only the variables the recipe names are read, so nothing else leaks into templates
  for (const name of envNames(recipe)) vars[`env.${name}`] = processEnv[name]?.trim() ?? "";

  for (const [field, def] of Object.entries(recipe.settings?.fields ?? {})) {
    const explicit = cleanValue(stored[field], absRoot);
    vars[`settings.${field}`] = effective(def, explicit, vars, absRoot) ?? "";
    if (def.env && explicit) env[def.env] = explicit;
  }
  for (const [name, value] of Object.entries(recipe.vars ?? {})) {
    const chosen = pick(value, vars);
    vars[name] = chosen === undefined ? "" : render(chosen, vars);
  }
  return { recipe, root: absRoot, vars, env, stored };
}

export function createContext(
  recipe: Recipe,
  root: string,
  versionInput: unknown,
  stored: StoredSettings = readStoredSettings(recipe, root),
  options: ContextOptions = {}
): ReleaseContext | null {
  const repo = createRepoContext(recipe, root, stored, options);
  const vars = parseVersion(recipe, versionInput, repo.vars);
  if (!vars) return null;
  return { ...repo, version: String(vars.version), vars };
}

export { isSet };
