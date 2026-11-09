/**
 * The Builds page's GitHub builds: a normal build of a branch, and a beta
 * build (master + the branch's open PR, for sending a customer a quick fix).
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

process.env.RELEASE_RECIPE = path.join(import.meta.dirname, "../recipes/wpsp-pro.recipe.json");
process.env.RELEASE_REPO ??= tmpdir();

const { CiBuilds, betaVersion, pushedBranches } = await import("../console/server/release/ciBuilds.ts");

type Result = { ok: boolean; stdout?: string; stderr?: string };

/** A fake gh: `pr list` and `workflow run` answer separately. */
function fake({ pr = { ok: true, stdout: "[]" }, run = { ok: true } }: { pr?: Result; run?: Result } = {}) {
  const calls: string[][] = [];
  const logged: string[] = [];
  const ci = new CiBuilds(
    "/repo",
    async (command, args) => {
      calls.push([command, ...args]);
      const result = args[0] === "pr" ? pr : run;
      return { ok: result.ok, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
    },
    (message) => logged.push(message),
  );
  return { ci, calls, logged };
}

const openPr = (baseRefName = "release/4.17.6") => ({ ok: true, stdout: JSON.stringify([{ number: 3556, title: "Fix coupons", baseRefName }]) });

describe("normal build", () => {
  it("runs the workflow on the branch, without asking for a PR", async () => {
    const { ci, calls } = fake();
    expect(await ci.dispatch("fix/coupon-bug")).toBeNull();
    expect(calls).toEqual([["gh", "workflow", "run", "build-and-export.yml", "--ref", "fix/coupon-bug"]]);
  });
});

describe("beta build", () => {
  it("finds the open PR, then runs the workflow's beta build", async () => {
    const { ci, calls } = fake({ pr: openPr() });
    expect(await ci.dispatch("fix/coupon-bug", { beta: true })).toEqual({ pr: 3556, title: "Fix coupons", base: "release/4.17.6", version: "4.17.6-beta" });
    expect(calls[0]).toEqual(expect.arrayContaining(["gh", "pr", "list", "--head", "fix/coupon-bug", "--state", "open"]));
    expect(calls[1]).toEqual(["gh", "workflow", "run", "build-and-export.yml", "--ref", "fix/coupon-bug", "-f", "beta=true"]);
  });

  it("does not start a run without an open PR, and says why", async () => {
    const { ci, calls } = fake();
    await expect(ci.dispatch("fix/no-pr", { beta: true })).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('A beta build needs an open PR from "fix/no-pr"'),
    });
    expect(calls).toHaveLength(1);
  });

  it("does not start a run when GitHub can't say", async () => {
    const failed = fake({ pr: { ok: false, stderr: "HTTP 401" } });
    await expect(failed.ci.dispatch("fix/x", { beta: true })).rejects.toMatchObject({ status: 502 });
    expect(failed.calls).toHaveLength(1);
    expect(failed.logged).toHaveLength(1);

    await expect(fake({ pr: { ok: true, stdout: "nope" } }).ci.dispatch("fix/x", { beta: true })).rejects.toMatchObject({ status: 502 });
  });

  it("explains a branch whose workflow is too old for beta builds", async () => {
    const stderr = 'could not create workflow dispatch event: HTTP 422: Unexpected inputs provided: ["beta"]';
    const { ci, logged } = fake({ pr: openPr(), run: { ok: false, stderr } });
    await expect(ci.dispatch("old/branch", { beta: true })).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("too old to make beta builds. Merge develop into the branch"),
    });
    expect(logged).toEqual([]);
  });

  it("keeps the other errors as they were", async () => {
    await expect(fake({ pr: openPr(), run: { ok: false, stderr: "HTTP 422: No ref found for: nope" } }).ci.dispatch("nope", { beta: true })).rejects.toMatchObject({ status: 404 });
    await expect(fake({ pr: openPr(), run: { ok: false, stderr: "HTTP 500" } }).ci.dispatch("fix/x", { beta: true })).rejects.toMatchObject({ status: 502 });
  });

  it("refuses an unsafe branch before calling gh", async () => {
    const { ci, calls } = fake({ pr: openPr() });
    await expect(ci.dispatch("--evil", { beta: true })).rejects.toMatchObject({ status: 400 });
    expect(calls).toEqual([]);
  });
});

describe("betaVersion", () => {
  it("stamps what the workflow stamps: the target branch's version plus -beta", () => {
    expect(betaVersion("release/4.17.6")).toBe("4.17.6-beta");
    // A hotfix keeps its fourth part, so the beta sorts above the release it fixes.
    expect(betaVersion("hotfix/4.17.5.1")).toBe("4.17.5.1-beta");
    // No version in the name: the workflow falls back to package.json, which the console can't see.
    expect(betaVersion("develop")).toBeNull();
  });
});

describe("pushedBranches", () => {
  const base = mkdtempSync(path.join(tmpdir(), "ci-branches-"));
  afterAll(() => rmSync(base, { recursive: true, force: true }));
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" });

  it("suggests origin's branches, newest first, without HEAD or local-only branches", async () => {
    const origin = path.join(base, "origin");
    const clone = path.join(base, "clone");
    git(base, "init", "-q", "-b", "develop", origin);
    git(origin, "config", "user.email", "t@example.com");
    git(origin, "config", "user.name", "t");
    // Distinct commit dates, so the order is by date and not by name.
    const commit = (date: string) => execFileSync("git", ["commit", "-q", "--allow-empty", "-m", date], { cwd: origin, env: { ...process.env, GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date } });
    commit("2026-01-01T00:00:00Z");
    git(origin, "checkout", "-q", "-b", "fix/new");
    commit("2026-03-01T00:00:00Z");
    git(origin, "checkout", "-q", "-b", "release/4.17.7", "develop");
    commit("2026-02-01T00:00:00Z");
    git(base, "clone", "-q", origin, clone);
    git(clone, "checkout", "-q", "-b", "local/only");

    expect(await pushedBranches(clone)).toEqual(["fix/new", "release/4.17.7", "develop"]);
  });

  it("is empty when git can't answer", async () => {
    expect(await pushedBranches(path.join(base, "nowhere"))).toEqual([]);
    expect(await pushedBranches(base, async () => { throw new Error("no git"); })).toEqual([]);
  });

  it("drops names gh should never get", async () => {
    const git = async () => "refs/remotes/origin/HEAD\nrefs/remotes/origin/ok/branch\nrefs/remotes/origin/-flag\n\n";
    expect(await pushedBranches("/repo", git)).toEqual(["ok/branch"]);
  });
});
