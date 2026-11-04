/**
 * Working-tree changes from `git status --porcelain=v1 -z`.
 *
 * The release tooling's own folders (recipe `reset.hide`) are left out: their
 * edits are not release work, so Changes, Reset and the Setup check skip them.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_CHANGES = 500;

export type ChangeKind = "modified" | "added" | "deleted" | "renamed" | "untracked" | "conflicted" | "other";

export interface Change {
  path: string;
  /** Previous path for a rename. */
  from: string | null;
  kind: ChangeKind;
  staged: boolean;
}

export interface Changes {
  changes: Change[];
  truncated: boolean;
  /** Changes left out because they are under a hidden folder. */
  hidden: number;
}

export type GitRunner = (args: string[], cwd: string) => Promise<string>;

export const runGit: GitRunner = async (args, cwd) => {
  const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 8 * 1024 * 1024, encoding: "utf8" });
  return stdout;
};

function kindFor(x: string, y: string): ChangeKind {
  if (x === "?" && y === "?") return "untracked";
  if (x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D")) return "conflicted";
  if (x === "R" || y === "R") return "renamed";
  if (x === "A") return "added";
  if (x === "D" || y === "D") return "deleted";
  if (x === "M" || y === "M" || x === "T" || y === "T") return "modified";
  return "other";
}

export function parseStatus(output: string): Omit<Changes, "hidden"> {
  const fields = output.split("\0");
  const changes: Change[] = [];
  let truncated = false;

  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    if (field.length < 4) continue;
    const x = field[0];
    const y = field[1];
    const filePath = field.slice(3);
    let from: string | null = null;
    // a rename or copy is followed by its source path as the next field
    if (x === "R" || x === "C") {
      from = fields[i + 1] ?? null;
      i++;
    }
    if (changes.length >= MAX_CHANGES) {
      truncated = true;
      break;
    }
    changes.push({ path: filePath, from, kind: kindFor(x, y), staged: x !== " " && x !== "?" });
  }

  changes.sort((a, b) => a.path.localeCompare(b.path));
  return { changes, truncated };
}

export const isHidden = (filePath: string, hide: string[]) => hide.some((prefix) => filePath.startsWith(prefix));

export function releaseChanges(output: string, hide: string[] = []): Changes {
  const { changes, truncated } = parseStatus(output);
  const visible = changes.filter((c) => !isHidden(c.path, hide));
  return { changes: visible, truncated, hidden: changes.length - visible.length };
}

export const STATUS_ARGS = ["status", "--porcelain=v1", "-z", "--untracked-files=all"];

export async function workingTreeChanges(root: string, hide: string[] = [], git: GitRunner = runGit): Promise<Changes> {
  return releaseChanges(await git(STATUS_ARGS, root), hide);
}
