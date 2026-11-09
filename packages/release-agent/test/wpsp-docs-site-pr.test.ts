/**
 * The WPSP recipe's "Open docs PR on marketing site" stage: its place in the
 * pipeline, the gh probe, and the status it shows from the PR's state. The
 * console parity suite leaves this stage out (the console has no such stage).
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createContext } from "../src/recipe/context.ts";
import { openRecipe } from "../src/recipe/load.ts";
import { stageStates } from "../src/recipe/stages.ts";
// @ts-expect-error the hooks are plain JavaScript in the product's repo
import { docsSiteBranch, docsSitePrProbe } from "../recipes/wpsp-pro.hooks.mjs";

const { recipe, hooks } = await openRecipe(path.join(import.meta.dirname, "../recipes/wpsp-pro.recipe.json"));
const root = mkdtempSync(path.join(tmpdir(), "docs-site-pr-"));
const ANALYSIS = "docs/releases/4.17.7/release.md";
const withAnalysis = (dir: string) => {
  mkdirSync(path.join(dir, path.dirname(ANALYSIS)), { recursive: true });
  writeFileSync(path.join(dir, ANALYSIS), "# 4.17.7\n");
};
withAnalysis(root);
afterAll(() => rmSync(root, { recursive: true, force: true }));

function state(probe: unknown) {
  const ctx = createContext(recipe, root, "4.17.7", {}, { processEnv: {} })!;
  const probes = probe === undefined ? {} : { docsSitePr: probe };
  return stageStates(ctx, { builds: [], probes, hooks }).find((s) => s.id === "docs-site-pr")!;
}

const pr = (state: string) => ({ exists: true, number: 712, state, url: "https://github.com/awesomemotive/wp-simple-pay-site/pull/712" });

describe("docs-site-pr stage", () => {
  it("comes right after the docs stage, needs gh, and runs the slash command", () => {
    const ids = recipe.stages.map((s) => s.id);
    expect(ids[ids.indexOf("docs") + 1]).toBe("docs-site-pr");

    const stage = recipe.stages.find((s) => s.id === "docs-site-pr")!;
    expect(stage).toMatchObject({ group: "prepare", prompt: "/wpsp-docs-site-pr {version}", requires: ["gh"] });
    expect(recipe.checks!.find((c) => c.id === "gh")!.stages).toContain("docs-site-pr");
    expect(state(undefined).prompt).toBe("/wpsp-docs-site-pr 4.17.7");
  });

  it("is done once the sync PR is open or merged", () => {
    expect(state(pr("open"))).toMatchObject({
      status: "done",
      remote: { tone: "success", text: "Docs PR #712 on the marketing site is open.", url: pr("open").url },
    });
    expect(state(pr("merged")).status).toBe("done");
    expect(state(pr("merged")).remote!.rerunWarning).toContain("instead of opening a second PR");
  });

  it("is not done when the PR was closed unmerged, and says so", () => {
    expect(state(pr("closed"))).toMatchObject({ status: "ready", remote: { tone: "warning", text: expect.stringContaining("closed without merging") } });
  });

  it("is ready with no PR, and untracked when GitHub could not be asked", () => {
    expect(state({ exists: false })).toMatchObject({ status: "ready", tracked: true, remote: null });
    expect(state(null)).toMatchObject({ status: "ready", tracked: false, remote: null });
  });
});

describe("docs-site-pr waits for Update customer docs", () => {
  const repo = mkdtempSync(path.join(tmpdir(), "docs-site-pr-git-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "pipe" });
  const write = (file: string, content: string) => {
    mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    writeFileSync(path.join(repo, file), content);
  };
  const stateIn = (probe?: unknown) => {
    const ctx = createContext(recipe, repo, "4.17.7", {}, { processEnv: {} })!;
    return stageStates(ctx, { builds: [], probes: probe === undefined ? {} : { docsSitePr: probe }, hooks }).find((s) => s.id === "docs-site-pr")!;
  };

  beforeAll(() => {
    git("init", "-q");
    git("config", "user.email", "t@example.com");
    git("config", "user.name", "t");
    write("docs-user/faq/01-a.md", "# A\n");
    write("readme.txt", "x\n");
    git("add", "-A");
    git("commit", "-qm", "4.17.6");
    git("tag", "4.17.6");
    // A later tag must not count as the base for 4.17.7.
    git("tag", "4.17.8");
    withAnalysis(repo);
  });
  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  it("is blocked while docs-user/ matches the previous release", () => {
    write("readme.txt", "changed outside the docs\n");
    expect(stateIn({ exists: false })).toMatchObject({
      status: "blocked",
      blockedReason: "Run Update customer docs first. docs-user/ has not changed since 4.17.6, so there is nothing new to sync.",
    });
  });

  it("unlocks on an uncommitted edit, a new untracked article, or a commit", () => {
    write("docs-user/faq/01-a.md", "# A, edited\n");
    expect(stateIn({ exists: false })).toMatchObject({ status: "ready", blockedReason: null });

    git("checkout", "-q", "--", "docs-user");
    write("docs-user/faq/02-b.md", "# B\n");
    expect(stateIn({ exists: false }).status).toBe("ready");

    git("add", "-A");
    git("commit", "-qm", "docs");
    expect(stateIn().status).toBe("ready");
  });

  it("shows done once the PR exists, whatever the docs say", () => {
    git("reset", "-q", "--hard", "4.17.6");
    expect(stateIn(pr("merged"))).toMatchObject({ status: "done", blockedReason: null });
  });
});

describe("docs-site-pr waits for the analysis, like the docs stage", () => {
  it("is blocked until the release analysis exists", () => {
    const bare = mkdtempSync(path.join(tmpdir(), "docs-site-pr-bare-"));
    try {
      const ctx = createContext(recipe, bare, "4.17.7", {}, { processEnv: {} })!;
      const stage = stageStates(ctx, { builds: [], probes: { docsSitePr: { exists: false } }, hooks }).find((s) => s.id === "docs-site-pr")!;
      expect(stage).toMatchObject({ status: "blocked", blockedReason: expect.stringContaining("Run Draft changelog & analysis first") });
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });
});

describe("docsSitePrProbe", () => {
  const api = (result: { ok: boolean; stdout: string }, calls: string[][] = []) => ({
    vars: { version: "4.17.7" },
    run: async (command: string, args: string[]) => {
      calls.push([command, ...args]);
      return { ...result, stderr: "" };
    },
  });

  it("asks gh for the version's sync branch on the site repo", async () => {
    const calls: string[][] = [];
    await docsSitePrProbe(api({ ok: true, stdout: "[]" }, calls));
    expect(docsSiteBranch("4.17.7")).toBe("docs/sync-4.17.7-user-docs");
    expect(calls[0]).toEqual(expect.arrayContaining(["gh", "--repo", "awesomemotive/wp-simple-pay-site", "--head", "docs/sync-4.17.7-user-docs", "--state", "all"]));
  });

  it("reads the PR, no PR, and failures", async () => {
    const stdout = JSON.stringify([{ number: 712, state: "MERGED", url: "u" }]);
    expect(await docsSitePrProbe(api({ ok: true, stdout }))).toEqual({ exists: true, number: 712, state: "merged", url: "u" });
    expect(await docsSitePrProbe(api({ ok: true, stdout: "[]" }))).toEqual({ exists: false });
    expect(await docsSitePrProbe(api({ ok: false, stdout: "" }))).toBeNull();
    expect(await docsSitePrProbe(api({ ok: true, stdout: "not json" }))).toBeNull();
  });
});
