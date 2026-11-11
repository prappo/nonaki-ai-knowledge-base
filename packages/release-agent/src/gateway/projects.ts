/**
 * Projects from the web app: finding the git repos inside the folders this
 * machine allowed (`release-agent allow`), checking a folder and recipe, and
 * adding or removing a project, all decided here on the machine.
 *
 * Paths are resolved to their real location before any check, so a symlink
 * can't lead out of the allowed folders, and discovery never follows one.
 */

import { existsSync, realpathSync, type Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { openRecipe } from "../recipe/load.ts";
import { runGit, type GitRunner } from "../repo/git.ts";
import { builtinRecipes, defaultRecipe, slug, type RepoConfig } from "../agent/config.ts";

export class ProjectError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Where a repo's own recipe lives, chosen with the recipe name "repo". */
export const REPO_RECIPE = "repo";
/** Deep enough for a WordPress plugin inside a Local site (Local Sites/<site>/app/public/wp-content/plugins/<plugin>). */
const MAX_DEPTH = 7;
const MAX_REPOS = 300;
const MAX_DIRS = 20_000;
const SKIP = new Set(["node_modules", "vendor", "bower_components", "dist", "build", "Library", "Applications", ".Trash"]);

/** The real path, or null when it doesn't exist. */
export function real(p: string): string | null {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
}

export function inside(target: string, roots: string[]): boolean {
  return roots.some((root) => target === root || target.startsWith(root.endsWith(path.sep) ? root : root + path.sep));
}

/** The allowed folders, as real paths (a missing one is left out). */
export const realRoots = (roots: string[]) => roots.map(real).filter((r): r is string => r !== null);

/** owner/name from a GitHub remote URL (https or ssh), or null. */
export function githubRepoOf(remote: string): string | null {
  const m = remote.trim().match(/github\.com[:/]([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

async function gitInfo(dir: string, git: GitRunner) {
  const [branch, remote] = await Promise.all([
    git(["branch", "--show-current"], dir).then((s) => s.trim() || null, () => null),
    git(["remote", "get-url", "origin"], dir).then((s) => s.trim(), () => ""),
  ]);
  return { branch, githubRepo: githubRepoOf(remote) };
}

export interface FoundRepo {
  path: string;
  name: string;
  branch: string | null;
  githubRepo: string | null;
  /** The repo carries its own .release/recipe.json. */
  hasRepoRecipe: boolean;
  /** The project id when this machine already serves it. */
  projectId: string | null;
  /** Its recipe then: "repo", a built-in name, or "custom" (a recipe file elsewhere). */
  recipe: string | null;
  /** …and the name the machine gave it. */
  projectName: string | null;
}

/** A served repo's recipe file, as the web app names recipes. */
export function recipeKey(repo: RepoConfig): string {
  if (defaultRecipe(repo.path) === repo.recipe) return REPO_RECIPE;
  return builtinRecipes().find((r) => r.file === repo.recipe)?.name ?? "custom";
}

/**
 * The git repos inside the allowed folders: breadth-first, not into a repo
 * once found, not through symlinks, hidden folders or dependency folders.
 */
export async function discoverRepos(roots: string[], served: RepoConfig[], git: GitRunner = runGit): Promise<{ roots: string[]; repos: FoundRepo[]; truncated: boolean }> {
  const allowed = realRoots(roots);
  const servedBy = new Map(served.map((r) => [real(r.path) ?? r.path, r]));
  const found: string[] = [];
  let queue = allowed.map((dir) => ({ dir, depth: 0 }));
  let visited = 0;
  let truncated = false;

  while (queue.length && !truncated) {
    const next: typeof queue = [];
    for (const { dir, depth } of queue) {
      if (++visited > MAX_DIRS || found.length >= MAX_REPOS) {
        truncated = true;
        break;
      }
      let entries: Dirent[];
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        continue; // unreadable: skip quietly
      }
      if (entries.some((e) => e.name === ".git")) {
        found.push(dir);
        continue;
      }
      if (depth >= MAX_DEPTH) continue;
      for (const e of entries) {
        // isDirectory() is false for symlinks, so they're never followed.
        if (e.isDirectory() && !e.name.startsWith(".") && !SKIP.has(e.name)) next.push({ dir: path.join(dir, e.name), depth: depth + 1 });
      }
    }
    queue = next;
  }

  const repos = await Promise.all(
    found.sort().map(async (dir) => ({
      path: dir,
      name: path.basename(dir),
      ...(await gitInfo(dir, git)),
      hasRepoRecipe: defaultRecipe(dir) !== null,
      projectId: servedBy.get(dir)?.id ?? null,
      recipe: servedBy.has(dir) ? recipeKey(servedBy.get(dir)!) : null,
      projectName: servedBy.get(dir)?.name ?? null,
    }))
  );
  return { roots: allowed, repos, truncated };
}

/** The recipes a project can use: the built-in ones by name, plus "repo" for its own. */
export async function listRecipes() {
  return Promise.all(
    builtinRecipes().map(async ({ name, file }) => {
      try {
        const { recipe } = await openRecipe(file);
        return { name, title: recipe.name, stages: recipe.stages.length };
      } catch (err) {
        return { name, title: name, stages: 0, error: (err as Error).message };
      }
    })
  );
}

export interface CheckedProject {
  path: string;
  name: string;
  /** "repo" or a built-in recipe name, as the web app stores it. */
  recipe: string;
  recipeFile: string;
  recipeTitle: string;
  stages: string[];
  branch: string | null;
  githubRepo: string | null;
}

/** Is this folder a git repo inside an allowed folder, and does the recipe load for it? */
export async function checkProject(input: { path?: unknown; recipe?: unknown }, roots: string[], git: GitRunner = runGit): Promise<CheckedProject> {
  if (typeof input.path !== "string" || !path.isAbsolute(input.path)) throw new ProjectError(400, "Pick the project's folder (an absolute path).");
  const dir = real(input.path);
  if (!dir) throw new ProjectError(404, `${input.path} doesn't exist on this machine.`);
  const allowed = realRoots(roots);
  if (!allowed.length) throw new ProjectError(409, "This machine hasn't allowed any folders. On it, run: release-agent allow <folder>");
  if (!inside(dir, allowed)) throw new ProjectError(403, `${dir} isn't inside the folders this machine allows.`);
  if (!existsSync(path.join(dir, ".git"))) throw new ProjectError(400, `${dir} isn't a git repository.`);

  const recipe = typeof input.recipe === "string" ? input.recipe.trim() : "";
  let recipeFile: string | null;
  if (recipe === REPO_RECIPE) {
    recipeFile = defaultRecipe(dir);
    if (!recipeFile) throw new ProjectError(400, `${path.basename(dir)} has no .release/recipe.json. Pick a built-in recipe instead.`);
  } else {
    recipeFile = builtinRecipes().find((r) => r.name === recipe)?.file ?? null;
    if (!recipeFile) throw new ProjectError(400, `No recipe "${recipe}" on this machine.`);
  }

  let opened;
  try {
    opened = await openRecipe(recipeFile);
  } catch (err) {
    throw new ProjectError(400, `The recipe doesn't load: ${(err as Error).message}`);
  }
  return {
    path: dir,
    name: opened.recipe.name,
    recipe,
    recipeFile,
    recipeTitle: opened.recipe.name,
    stages: opened.recipe.stages.map((s) => s.title),
    ...(await gitInfo(dir, git)),
  };
}

/** A free id for a new project: the name's slug, numbered when it's taken. */
export function projectId(name: string, taken: string[]): string {
  const base = slug(name);
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
  return id;
}

export function cleanName(v: unknown, fallback: string): string {
  const name = typeof v === "string" ? v.trim() : "";
  if (name.length > 80) throw new ProjectError(400, "That project name is too long.");
  return name || fallback;
}
