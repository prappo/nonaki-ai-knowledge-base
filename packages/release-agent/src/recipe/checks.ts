/**
 * Evaluates recipe Checks against the files on disk. Synchronous and offline,
 * so stage status can be recomputed on every request.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { resolvePath, type ReleaseContext } from "./context.ts";
import { render } from "./template.ts";
import type { Check } from "./types.ts";

function readFile(file: string): string | null {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/**
 * Whether a local tag exists, read straight from `.git`. A `.git` *file*
 * (a worktree) is treated as "no tag" rather than an error.
 */
export function hasLocalTag(repo: string, tag: string): boolean {
  const gitDir = path.join(repo, ".git");
  try {
    if (!statSync(gitDir).isDirectory()) return false;
  } catch {
    return false;
  }
  if (existsSync(path.join(gitDir, "refs", "tags", tag))) return true;
  const packed = readFile(path.join(gitDir, "packed-refs"));
  return packed !== null && packed.split("\n").some((line) => line.trim().endsWith(` refs/tags/${tag}`));
}

/** Paths of `fileExists` checks that failed, collected while evaluating. */
export type MissingSink = string[];

export function evaluate(check: Check, ctx: ReleaseContext, missing?: MissingSink): boolean {
  const p = (t: string) => resolvePath(ctx.root, render(t, ctx.vars));

  if ("fileExists" in check) {
    const file = p(check.fileExists);
    const ok = existsSync(file);
    if (!ok) missing?.push(file);
    return ok;
  }
  if ("fileMatches" in check) {
    const content = readFile(p(check.fileMatches));
    if (content === null) return false;
    const flags = check.flags ?? "m";
    return new RegExp(render(check.regex, ctx.vars, "regex"), flags).test(content);
  }
  if ("gitTag" in check) {
    return hasLocalTag(check.repo ? p(check.repo) : ctx.root, render(check.gitTag, ctx.vars));
  }
  if ("all" in check) {
    // keep going after a failure so `missing` lists every absent file
    let ok = true;
    for (const c of check.all) if (!evaluate(c, ctx, missing)) ok = false;
    return ok;
  }
  if ("any" in check) return check.any.some((c) => evaluate(c, ctx));
  if ("not" in check) return !evaluate(check.not, ctx);
  return false;
}
