/**
 * The Library's "Changes" view for user docs: one article diffed against the
 * previous release tag, in a real throwaway git repo.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repo = mkdtempSync(path.join(tmpdir(), "docs-diff-"));
process.env.RELEASE_RECIPE = path.join(import.meta.dirname, "../recipes/wpsp-pro.recipe.json");
process.env.RELEASE_REPO = repo;

const { docDiff } = await import("../console/server/release/docs.ts");
const { parseVersion } = await import("../console/server/release/version.ts");

const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
const write = (file: string, content: string) => {
  mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  writeFileSync(path.join(repo, file), content);
};
const version = parseVersion("4.17.5")!;

beforeAll(() => {
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  write("docs-user/guide/setup.md", "# Setup\n\nStep one.\n");
  write("docs-user/guide/same.md", "# Same\n");
  git("add", ".");
  git("commit", "-qm", "4.17.4");
  git("tag", "4.17.4");
  // committed after the tag, plus an uncommitted edit on top
  write("docs-user/guide/setup.md", "# Setup\n\nStep one.\nStep two.\n");
  git("commit", "-qam", "docs");
  write("docs-user/guide/setup.md", "# Setup\n\nStep one, revised.\nStep two.\n");
  write("docs-user/guide/brand-new.md", "# Brand new\n");
});

afterAll(() => rmSync(repo, { recursive: true, force: true }));

describe("docDiff", () => {
  it("diffs a modified article against the previous tag, uncommitted edits included", async () => {
    const diff = await docDiff(repo, version, "docs-user/guide/setup.md");

    expect(diff.baseTag).toBe("4.17.4");
    expect(diff.kind).toBe("modified");
    expect(diff.diff).toContain("-Step one.");
    expect(diff.diff).toContain("+Step one, revised.");
    expect(diff.diff).toContain("+Step two.");
    expect(diff.before).toBe("# Setup\n\nStep one.\n");
    expect(diff.after).toBe("# Setup\n\nStep one, revised.\nStep two.\n");
  });

  it("returns an untracked article whole", async () => {
    const diff = await docDiff(repo, version, "docs-user/guide/brand-new.md");

    expect(diff.kind).toBe("untracked");
    expect(diff.diff).toBe("# Brand new\n");
    expect(diff.before).toBeNull();
    expect(diff.after).toBe("# Brand new\n");
  });

  it("refuses unchanged articles and paths outside docs-user/", async () => {
    await expect(docDiff(repo, version, "docs-user/guide/same.md")).rejects.toThrow(/not changed since 4\.17\.4/);
    await expect(docDiff(repo, version, "docs-user/../package.json")).rejects.toThrow(/Only files in docs-user/);
    await expect(docDiff(repo, version, "src/index.ts")).rejects.toThrow(/Only files in docs-user/);
  });

  it("needs an earlier release tag", async () => {
    await expect(docDiff(repo, parseVersion("4.17.4")!, "docs-user/guide/setup.md")).rejects.toThrow(/no release tag before/);
  });
});
