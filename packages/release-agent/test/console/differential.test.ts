/**
 * Differential test: the Release Console's ORIGINAL modules (imported from the
 * WPSP checkout) vs release-agent + the WPSP recipe, compared field by field
 * over generated fixtures. The ported console tests check what they assert;
 * this checks everything else (exact wording, group labels, rule order).
 *
 * Runs only where the WPSP checkout is (WPSP_ROOT).
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as engine from "./adapter.ts";
import { WPSP_ROOT } from "./adapter.ts";

const CONSOLE = path.join(WPSP_ROOT, "tools/release-console/server");
const available = existsSync(path.join(CONSOLE, "release/stages.ts"));

/** Deterministic PRNG so failures reproduce. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 2 ** 32;
    return seed / 2 ** 32;
  };
}

describe.skipIf(!available)("differential: console vs release-agent", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let orig: Record<string, any>;
  let base: string;

  beforeAll(async () => {
    orig = {
      stages: await import(path.join(CONSOLE, "release/stages.ts")),
      version: await import(path.join(CONSOLE, "release/version.ts")),
      health: await import(path.join(CONSOLE, "release/health.ts")),
      risk: await import(path.join(CONSOLE, "runs/risk.ts")),
      config: await import(path.join(CONSOLE, "release/config.ts")),
    };
    base = mkdtempSync(path.join(tmpdir(), "release-agent-diff-"));
  });
  afterAll(() => rmSync(base, { recursive: true, force: true }));

  it("has the same stages, in order, with the same static fields", () => {
    const pick = (s: { id: string; group: string; title: string; command: string; irreversible?: boolean; browser?: boolean }) => ({
      id: s.id, group: s.group, title: s.title, command: s.command, irreversible: s.irreversible === true, browser: s.browser === true,
    });
    expect(engine.STAGES.map(pick)).toEqual(orig.stages.STAGES.map(pick));
  });

  it("labels the groups the same, in the same order", () => {
    expect(Object.fromEntries(engine.recipe.groups.map((g) => [g.id, g.label]))).toEqual(orig.stages.STAGE_GROUPS);
    expect(engine.recipe.groups.map((g) => g.id)).toEqual(Object.keys(orig.stages.STAGE_GROUPS));
  });

  it("orders the setup checks and their stages the same", async () => {
    const run = async () => ({ ok: true, stdout: "", stderr: "" });
    const root = path.join(base, "order/pro");
    mkdirSync(root, { recursive: true });
    const a = await orig.health.healthChecks({ root, version: orig.version.parseVersion("4.17.5"), run });
    const b = await engine.healthChecks({ root, version: engine.parseVersion("4.17.5"), run });
    expect(b.map((c) => [c.id, c.label, c.stages])).toEqual(a.map((c: { id: string; label: string; stages: string[] }) => [c.id, c.label, c.stages]));
  });

  it("computes identical stage states over 400 generated repos", () => {
    const random = rng(42);
    const files = (v: string) => {
      const b = v.split(".").slice(0, 3).join(".");
      const d = `docs/releases/${b}`;
      return [
        `${d}/release.md`, `${d}/${v}.md`, `${d}/marketing-site-changes.md`, `${d}/marketing-site-changes-${v}.md`,
        `docs/releases/${v}/reviews/README.md`, `build-audit/reports/${v}-build-diff.md`,
        `${d}/blog.html`, `${d}/blog-${v}-featured-image.jpg`, `${d}/blog-${v}-featured-image.webp`, `${d}/newsletter.html`,
        `${d}/twitter.txt`, `${d}/linkedin.txt`, `${d}/slack-pro.txt`, `${d}/slack-lite.txt`,
        `${d}/notification-pro.html`, `${d}/notification-lite.html`,
      ];
    };
    const release = (v: string, r: number) =>
      [
        undefined,
        null,
        { exists: false, tag: v },
        { exists: true, tag: v, url: "https://x/r", publishedAt: "2026-10-14T14:15:46Z", isDraft: false, assets: [`stripe-${v}.zip`] },
        { exists: true, tag: v, url: "", publishedAt: null, isDraft: false, assets: ["other.zip"] },
        { exists: true, tag: v, url: "https://x/d", publishedAt: null, isDraft: true, assets: [`stripe-${v}.zip`] },
      ][Math.floor(r * 6)];
    const note = (id: number, type: string[], v: string) => ({ id, title: "t", content: `<b>WP Simple Pay ${v}</b>`, type });
    const feeds = (v: string, r: number) =>
      [
        undefined,
        null,
        { live: [], draft: [] },
        { live: [], draft: [note(9, ["elite"], v)] },
        { live: [note(9, ["elite"], v)], draft: [note(10, ["lite"], v)] },
      ][Math.floor(r * 5)];
    const header = (v: string) => `<?php\n/**\n * Version: ${v}\n */\ndefine( 'SIMPLE_PAY_VERSION', '${v}' );\n`;

    let compared = 0;
    for (let i = 0; i < 400; i++) {
      const root = path.join(base, `repo-${i}`, "pro");
      const lite = path.join(base, `repo-${i}`, "lite");
      mkdirSync(root, { recursive: true });
      const v = random() < 0.25 ? "4.17.4.1" : "4.17.5";
      const write = (p: string, c = "") => {
        mkdirSync(path.dirname(p), { recursive: true });
        writeFileSync(p, c);
      };
      for (const f of files(v)) if (random() < 0.5) write(path.join(root, f));
      const mainV = [v, "4.17.4", `${v}.1`][Math.floor(random() * 3)];
      if (random() < 0.7) write(path.join(root, "simple-pay.php"), header(mainV));
      if (random() < 0.5) write(path.join(lite, "stripe-checkout.php"), ` * Version: ${random() < 0.5 ? v : "4.17.4"}\n`);
      if (random() < 0.3) write(path.join(root, ".git/refs/tags", v), "abc\n");
      if (random() < 0.3) write(path.join(lite, ".git/packed-refs"), `abc refs/tags/${v}\n`);
      if (random() < 0.1) write(path.join(lite, ".git/refs/tags", `${v}.1`), "abc\n");

      const ctx = {
        root,
        version: orig.version.parseVersion(v),
        litePath: lite,
        svnPath: path.join(base, `repo-${i}`, "svn"),
        liteRelease: release(v, random()),
        notificationFeeds: feeds(v, random()),
      };
      const a = orig.stages.stageStates(ctx);
      const b = engine.stageStates({ ...ctx, version: engine.parseVersion(v)! });
      for (let s = 0; s < a.length; s++) {
        // compare every field the console reports
        const expected = a[s];
        const actual = Object.fromEntries(Object.keys(expected).map((k) => [k, (b[s] as Record<string, unknown>)[k]]));
        expect(actual, `repo-${i} ${v} ${expected.id}`).toEqual(expected);
        compared++;
      }
    }
    expect(compared).toBe(400 * 14);
  });

  it("parses versions identically", () => {
    for (const input of ["4.17.5", "4.17.4.1", " 4.17.5\n", "4.17", "v4.17.5", "4.17.5.1.2", "../x", "4..5", 4175, null, "10.0.0", "0.0.0.0"]) {
      expect(engine.parseVersion(input), String(input)).toEqual(orig.version.parseVersion(input));
    }
  });

  it("assesses a command corpus, chains and overlaps included, identically", () => {
    const corpus = [
      "git push", "git push --tags", "git push origin :refs/tags/1", "git tag", "git tag -l x", "git tag 4.17.5", "git commit -m x",
      "git reset --hard", "git clean -fd", "git restore x", "git status", "gh release create 1", "gh release view 1",
      "gh api -X POST repos/o/r/releases", "gh api repos/o/r/issues -f t=x", "gh api repos/o/r/pulls/1", "gh pr create", "gh pr view 1",
      "gh issue close 1", "svn commit -m x", "svn ci -m x", "svn status", "svn cp ^/trunk ^/tags/1 -m x", "svn rm trunk/x",
      "bash .claude/scripts/lite-release/svn-commit.sh 4.17.5", "bash .claude/scripts/lite-release/svn-stage.sh 4.17.5",
      "wp wpsp-docs sync", "rsync --prune-empty-dirs a b", "tool --prune", "rm -rf x", "rm x", "npm run build", "npm run build:ui",
      "npm publish", "npx wp-scripts build", "curl -X POST u", "curl -s u", "curl u -d x",
    ];
    const commands = [...corpus];
    for (const a of corpus) for (const b of corpus) commands.push(`${a} && ${b}`, `${a} ${b}`);
    for (const c of commands) {
      expect(engine.assessBashRisk(c), c).toEqual(orig.risk.assessBashRisk(c));
    }
    expect(commands.length).toBe(corpus.length + 2 * corpus.length ** 2);
  });

  it("assesses browser scripts identically", () => {
    const scripts = [
      "wp.apiFetch({ method: 'POST' })", "fetch('/x', { method: 'DELETE' })", "fetch('/x')", "axios.post('/x')", "$.post('/x')",
      "document.getElementById('publish').click()", "x.post_status = 'future'", "x.value = 'publish'", "form.submit()",
      "buttons.find(b => b.innerText === 'Send Now').click()", "findButton('Save').click()", "document.title",
      "wp.apiFetch({ method: 'POST', data: { status: 'publish' } })", "x.click() // schedule", "dispatchEvent(new MouseEvent('click')) Save & Review",
    ];
    for (const text of scripts) {
      expect(engine.assessBrowserScriptRisk({ text }), text).toEqual(orig.risk.assessBrowserScriptRisk({ text }));
      expect(engine.assessToolRisk(engine.BROWSER_SCRIPT_TOOL, { text })).toEqual(orig.risk.assessToolRisk(orig.risk.BROWSER_SCRIPT_TOOL, { text }));
    }
  });

  it("runs identical setup checks over 60 generated machines", async () => {
    const random = rng(7);
    const pickOf = <T,>(xs: T[]) => xs[Math.floor(random() * xs.length)];
    for (let i = 0; i < 60; i++) {
      const dir = path.join(base, `machine-${i}`);
      const root = path.join(dir, "sites/wpsp/app/public/wp-content/plugins/wp-simple-pay-pro");
      const localDataDir = path.join(dir, "local");
      const nvmDir = path.join(dir, "nvm");
      mkdirSync(root, { recursive: true });
      mkdirSync(localDataDir, { recursive: true });
      if (random() < 0.6) mkdirSync(path.join(nvmDir, pickOf(["v16.20.2", "v18.1.0"])), { recursive: true });
      if (random() < 0.5) {
        writeFileSync(path.join(localDataDir, "sites.json"), JSON.stringify({ s1: { name: "wpsp", path: path.join(dir, "sites/wpsp") } }));
        if (random() < 0.5) {
          mkdirSync(path.join(localDataDir, "run/s1/mysql"), { recursive: true });
          writeFileSync(path.join(localDataDir, "run/s1/mysql/mysqld.sock"), "");
        }
      }
      if (random() < 0.4) mkdirSync(path.join(dir, "sites/wpsp/app/public/wp-content/plugins/wp-simple-pay-lite"), { recursive: true });
      const ok = (stdout = "") => ({ ok: true, stdout, stderr: "" });
      const fail = (stderr: string) => ({ ok: false, stdout: "", stderr });
      const answers: Record<string, { ok: boolean; stdout: string; stderr: string }> = {
        "git rev-parse": ok(pickOf(["release/4.17.5\n", "master\n", "hotfix/4.17.5\n", ""])),
        "git tag": ok(pickOf(["4.17.4.1\n4.17.4\n", "", "v4.17.3\n4.17.4\n", "beta\n"])),
        "git status": ok(pickOf(["", " M a\0", " M a\0?? tools/release-console/x\0", "R  new\0old\0"])),
        "gh auth": pickOf([ok("account prappo (keyring)"), ok(""), fail("not logged in"), fail("spawn gh ENOENT")]),
        "docker ps": pickOf([ok("x-wordpress-1\n"), ok("other\n"), fail("Cannot connect")]),
        "svn --version": pickOf([ok("1.14.5\n"), fail("spawn svn ENOENT")]),
        "security find-generic-password": pickOf([ok('"acct"<blob>="prappo"'), fail("not found")]),
      };
      const run = async (command: string, args: string[]) => answers[`${command} ${args[0]}`] ?? fail("unexpected");
      const version = random() < 0.8 ? "4.17.5" : null;

      const a = await orig.health.healthChecks({ root, version: version ? orig.version.parseVersion(version) : null, run, localDataDir, nvmDir });
      const b = await engine.healthChecks({ root, version: version ? engine.parseVersion(version) : null, run, localDataDir, nvmDir });
      expect(b, `machine-${i}`).toEqual(a);
    }
  });
});
