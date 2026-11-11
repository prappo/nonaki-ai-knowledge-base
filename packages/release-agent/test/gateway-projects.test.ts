/**
 * Adding projects from the web app: finding repos in the allowed folders, and
 * checking a folder and recipe on the machine.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkProject, discoverRepos, githubRepoOf, listRecipes, projectId } from "../src/gateway/projects.ts";

const base = realpathSync(mkdtempSync(path.join(tmpdir(), "gw-projects-")));
const allowed = path.join(base, "Local Sites");
const outside = path.join(base, "private");
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" });

function repo(dir: string, remote?: string) {
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "release/4.17.7");
  if (remote) git(dir, "remote", "add", "origin", remote);
}

beforeAll(() => {
  repo(path.join(allowed, "wpsp1/app/public/wp-content/plugins/wp-simple-pay-pro"), "git@github.com:awesomemotive/wp-simple-pay-pro.git");
  repo(path.join(allowed, "site2/app/public/wp-content/plugins/wpforms"), "https://github.com/awesomemotive/wpforms.git");
  // its own recipe
  mkdirSync(path.join(allowed, "site2/app/public/wp-content/plugins/wpforms/.release"), { recursive: true });
  writeFileSync(path.join(allowed, "site2/app/public/wp-content/plugins/wpforms/.release/recipe.json"), "{}");
  // not found: inside node_modules, hidden folders, and nested in another repo
  repo(path.join(allowed, "wpsp1/node_modules/some-pkg"));
  repo(path.join(allowed, ".hidden/repo"));
  repo(path.join(allowed, "wpsp1/app/public/wp-content/plugins/wp-simple-pay-pro/lib/nested"));
  // a repo outside, and a symlink to it from inside
  repo(path.join(outside, "secret-repo"));
  symlinkSync(path.join(outside, "secret-repo"), path.join(allowed, "link-out"));
  mkdirSync(path.join(allowed, "not-a-repo"));
});
afterAll(() => rmSync(base, { recursive: true, force: true }));

describe("discoverRepos", () => {
  it("finds the repos in the allowed folders, and only those", async () => {
    const wpspRecipe = (await import("../src/agent/config.ts")).builtinRecipes().find((r) => r.name === "wpsp-pro")!.file;
    const served = [{ id: "wp-simple-pay-pro", name: "WP Simple Pay Pro", path: path.join(allowed, "wpsp1/app/public/wp-content/plugins/wp-simple-pay-pro"), recipe: wpspRecipe }];
    const { repos, roots } = await discoverRepos([allowed], served);
    expect(roots).toEqual([allowed]);
    expect(repos).toEqual([
      {
        path: path.join(allowed, "site2/app/public/wp-content/plugins/wpforms"),
        name: "wpforms",
        branch: "release/4.17.7",
        githubRepo: "awesomemotive/wpforms",
        hasRepoRecipe: true,
        projectId: null,
        recipe: null,
        projectName: null,
      },
      {
        path: path.join(allowed, "wpsp1/app/public/wp-content/plugins/wp-simple-pay-pro"),
        name: "wp-simple-pay-pro",
        branch: "release/4.17.7",
        githubRepo: "awesomemotive/wp-simple-pay-pro",
        hasRepoRecipe: false,
        projectId: "wp-simple-pay-pro",
        recipe: "wpsp-pro",
        projectName: "WP Simple Pay Pro",
      },
    ]);
  });

  it("finds nothing without allowed folders", async () => {
    expect((await discoverRepos([], [])).repos).toEqual([]);
    expect((await discoverRepos([path.join(base, "missing")], [])).repos).toEqual([]);
  });
});

describe("checkProject", () => {
  const wpsp = path.join(allowed, "wpsp1/app/public/wp-content/plugins/wp-simple-pay-pro");

  it("accepts a repo inside an allowed folder with a built-in recipe", async () => {
    const checked = await checkProject({ path: wpsp, recipe: "wpsp-pro" }, [allowed]);
    expect(checked).toMatchObject({ path: wpsp, recipe: "wpsp-pro", recipeTitle: "WP Simple Pay Pro", branch: "release/4.17.7", githubRepo: "awesomemotive/wp-simple-pay-pro" });
    expect(checked.stages.length).toBeGreaterThan(5);
  });

  it("refuses folders outside, through symlinks, or not repos", async () => {
    await expect(checkProject({ path: path.join(outside, "secret-repo"), recipe: "wpsp-pro" }, [allowed])).rejects.toMatchObject({ status: 403 });
    await expect(checkProject({ path: path.join(allowed, "link-out"), recipe: "wpsp-pro" }, [allowed])).rejects.toMatchObject({ status: 403 });
    await expect(checkProject({ path: path.join(allowed, "wpsp1/../../private/secret-repo"), recipe: "wpsp-pro" }, [allowed])).rejects.toMatchObject({ status: 403 });
    await expect(checkProject({ path: path.join(allowed, "not-a-repo"), recipe: "wpsp-pro" }, [allowed])).rejects.toMatchObject({ status: 400 });
    await expect(checkProject({ path: path.join(allowed, "nope"), recipe: "wpsp-pro" }, [allowed])).rejects.toMatchObject({ status: 404 });
    await expect(checkProject({ path: "relative/path", recipe: "wpsp-pro" }, [allowed])).rejects.toMatchObject({ status: 400 });
    await expect(checkProject({ path: wpsp, recipe: "wpsp-pro" }, [])).rejects.toMatchObject({ status: 409 });
  });

  it("explains a recipe that can't be used", async () => {
    await expect(checkProject({ path: wpsp, recipe: "repo" }, [allowed])).rejects.toThrow(/no .release\/recipe.json/);
    await expect(checkProject({ path: wpsp, recipe: "nope" }, [allowed])).rejects.toThrow(/No recipe "nope"/);
    // The repo's own recipe exists but doesn't load: say why, before anything is added.
    await expect(checkProject({ path: path.join(allowed, "site2/app/public/wp-content/plugins/wpforms"), recipe: "repo" }, [allowed])).rejects.toThrow(/doesn't load/);
  });
});

describe("helpers", () => {
  it("reads GitHub remotes", () => {
    expect(githubRepoOf("git@github.com:awesomemotive/wp-simple-pay-pro.git")).toBe("awesomemotive/wp-simple-pay-pro");
    expect(githubRepoOf("https://github.com/awesomemotive/wpforms")).toBe("awesomemotive/wpforms");
    expect(githubRepoOf("https://gitlab.com/a/b.git")).toBeNull();
  });

  it("numbers a taken project id", () => {
    expect(projectId("WP Simple Pay Pro", [])).toBe("wp-simple-pay-pro");
    expect(projectId("WP Simple Pay Pro", ["wp-simple-pay-pro", "wp-simple-pay-pro-2"])).toBe("wp-simple-pay-pro-3");
  });

  it("lists the built-in recipes", async () => {
    expect(await listRecipes()).toContainEqual(expect.objectContaining({ name: "wpsp-pro", title: "WP Simple Pay Pro" }));
  });
});
