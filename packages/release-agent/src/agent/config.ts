/**
 * The agent's own config: which server it's paired with, its token, and the
 * repos it serves. Stored in ~/.release-agent/config.json (mode 600).
 */

import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface RepoConfig {
  /** Stable id the server uses (slug of the name). */
  id: string;
  name: string;
  /** Absolute repo root. */
  path: string;
  /** Absolute recipe file. */
  recipe: string;
}

export interface AgentConfig {
  server: string;
  agentId: string;
  token: string;
  name: string;
  repos: RepoConfig[];
  /** Capabilities to advertise on top of the detected ones (e.g. "browser"). */
  capabilities: string[];
}

export const agentHome = () => process.env.RELEASE_AGENT_HOME ?? path.join(homedir(), ".release-agent");
const configFile = () => path.join(agentHome(), "config.json");

export function readConfig(): AgentConfig | null {
  try {
    return JSON.parse(readFileSync(configFile(), "utf8")) as AgentConfig;
  } catch {
    return null;
  }
}

export function writeConfig(config: AgentConfig): void {
  mkdirSync(agentHome(), { recursive: true, mode: 0o700 });
  const tmp = `${configFile()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, configFile());
  chmodSync(configFile(), 0o600);
}

export const slug = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "repo";

/** Where a repo's recipe is by default: `<repo>/.release/recipe.json`. */
export function defaultRecipe(repo: string): string | null {
  const file = path.join(repo, ".release", "recipe.json");
  return existsSync(file) ? file : null;
}

/**
 * Recipes that ship with the agent (the package's recipes/ folder), for repos
 * that don't carry their own .release/recipe.json yet. Works from source
 * (src/agent/) and from the installed bundle (dist/).
 */
function builtinDir(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return [path.join(here, "../recipes"), path.join(here, "../../recipes")].find((d) => existsSync(d)) ?? null;
}

export function builtinRecipes(): { name: string; file: string }[] {
  const dir = builtinDir();
  if (!dir) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".recipe.json"))
    .map((f) => ({ name: f.replace(/\.recipe\.json$/, ""), file: path.join(dir, f) }));
}

/** `--recipe` may be a file path or a built-in recipe name (see `release-agent recipes`). */
export function resolveRecipe(value: string): string | null {
  const builtin = builtinRecipes().find((r) => r.name === value);
  if (builtin) return builtin.file;
  const file = path.resolve(value);
  return existsSync(file) ? file : null;
}
