/**
 * The Release Console's side of the content review: starting the stage runs
 * the fixed checks and a read-only reviewer, its answer is saved when its turn
 * ends, and the findings API dismisses and fixes.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RunManager } from "../src/runs/runner.ts";
import { MemoryRunStore } from "../src/runs/store.ts";
import { scriptedQuery, text, type Script } from "./console/helpers.ts";

const answer = "Reviewed.\n\n```json\n" + JSON.stringify({
  content_review: {
    summary: "One unclear line.",
    findings: [{ level: "warning", file: "blog", category: "writing", quote: "Checkout is faster", problem: "Say how much faster." }],
  },
  release_console: { status: "ok", summary: "Reviewed 8 files.", files: [], followups: [] },
}) + "\n```";

const resultWith = (value: string): SDKMessage =>
  ({ type: "result", subtype: "success", uuid: `r-${Math.random()}`, session_id: "session-1", is_error: false, result: value, total_cost_usd: 0.1, duration_ms: 10 }) as unknown as SDKMessage;

describe("content review in the console", () => {
  let server: http.Server;
  let base: string;
  let calls: Array<{ options: Record<string, unknown> }>;
  let prompts: string[];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Json = any;
  const post = (url: string, body: unknown = {}): Promise<{ status: number; body: Json }> =>
    fetch(base + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  const get = (url: string): Promise<{ status: number; body: Json }> => fetch(base + url).then(async (r) => ({ status: r.status, body: await r.json() }));
  const until = async (check: () => Promise<boolean>) => {
    for (const started = Date.now(); !(await check()); ) {
      if (Date.now() - started > 3000) throw new Error("timed out");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };

  beforeAll(async () => {
    const repo = mkdtempSync(path.join(tmpdir(), "content-review-console-"));
    const dir = path.join(repo, "docs/releases/4.17.5");
    mkdirSync(dir, { recursive: true });
    // no web links, so the link checks have nothing to fetch
    writeFileSync(path.join(dir, "blog.html"), "<h1>WP Simple Pay 4.17.5</h1><p>Checkout is faster.</p>");
    writeFileSync(path.join(dir, "release.md"), "# 4.17.5\n");
    process.env.RELEASE_REPO = repo;
    process.env.RELEASE_RECIPE = path.resolve("recipes/wpsp-pro.recipe.json");

    const { createApp } = await import("../console/server/http/app.ts");
    const { isReviewStage, reviewerSessionOptions } = await import("../console/server/release/contentReview.ts");

    prompts = [];
    const script: Script = async function* (ctx) {
      const prompt = (await ctx.nextInput()) ?? "";
      prompts.push(prompt);
      yield text("Reading the content.");
      yield resultWith(prompt.includes("content reviewer") ? answer : '```json\n{"release_console":{"status":"ok","summary":"Fixed.","files":[],"followups":[]}}\n```');
      await ctx.nextInput();
    };
    const scripted = scriptedQuery(script);
    calls = scripted.calls as never;
    const baseOptions = { extraArgs: { chrome: null }, settings: { enableAllProjectMcpServers: true }, env: { A: "1" } };
    const manager = new RunManager(repo, scripted.queryFn, (stageId) => (isReviewStage(stageId) ? reviewerSessionOptions(baseOptions) : baseOptions), new MemoryRunStore());
    const allowedHosts: string[] = [];
    server = http.createServer(createApp({ root: repo, manager, allowedHosts, allowedOrigins: [] }));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as { port: number };
    allowedHosts.push(`127.0.0.1:${port}`);
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(() => server?.close());

  it("runs the checks and a read-only reviewer, saves its answer, and lets findings be dismissed and fixed", async () => {
    const before = await get("/api/content-review?version=4.17.5");
    expect(before.body.review).toMatchObject({ passed: false, reason: "The review hasn't run yet." });

    const started = await post("/api/runs", { stageId: "marketing-review", version: "4.17.5" });
    expect(started.status).toBe(201);
    const runId = started.body.run.id as string;
    // the console's prompt, not the card's label
    expect(started.body.run.prompt).toContain("You are the content reviewer for release 4.17.5");

    // the reviewer can only read: no Chrome, no MCP servers, no writing tools
    const options = calls[0].options;
    expect(options.tools).toEqual(["Read", "Grep", "Glob", "WebFetch"]);
    expect(options.disallowedTools).toEqual(expect.arrayContaining(["Write", "Edit", "Bash"]));
    expect(options.mcpServers).toEqual({});
    expect(options.strictMcpConfig).toBe(true);
    expect(options.extraArgs).toBeUndefined();
    expect((options.env as Record<string, string>).A).toBe("1");

    await until(async () => (await get(`/api/runs/${runId}`)).body.run?.status === "done");

    const after = (await get("/api/content-review?version=4.17.5")).body.review;
    expect(after.reviewer).toMatchObject({ status: "done", runId, summary: "One unclear line.", fresh: true });
    expect(after.checks).toMatchObject({ fresh: true, links: "skipped" });
    // seven pieces were never written, the newsletter among them
    expect(after.counts).toMatchObject({ blocker: 7, warning: 1 });
    expect(after.reason).toBe("7 blockers to fix, and 1 warning to fix or dismiss.");

    const blocker = after.findings.find((item: Json) => item.level === "blocker");
    expect((await post("/api/content-review/dismiss", { version: "4.17.5", id: blocker.id, reason: "fine" })).status).toBe(400);
    const warning = after.findings.find((item: Json) => item.level === "warning");
    const dismissed = await post("/api/content-review/dismiss", { version: "4.17.5", id: warning.id, reason: "Fine as it is." });
    expect(dismissed.status).toBe(200);
    expect(dismissed.body.review.counts).toMatchObject({ warning: 0, dismissed: 1 });

    // the email draft waits for the review
    const draft = await post("/api/runs", { stageId: "email-draft", version: "4.17.5" });
    expect(draft.status).toBe(409);

    // Fix with agent: a Write marketing content session with the open findings
    const fix = await post("/api/content-review/fix", { version: "4.17.5" });
    expect(fix.status).toBe(201);
    expect(fix.body.run.stageId).toBe("marketing");
    expect(fix.body.run.prompt).toContain("Fix the problems the content review found");
    expect(fix.body.run.prompt).toContain("newsletter.html");
    expect(fix.body.run.prompt).not.toContain("Say how much faster.");
    // that session isn't read-only
    expect(calls[1].options.tools).toBeUndefined();
  });

  it("rejects requests for a bad version", async () => {
    expect((await get("/api/content-review?version=nope")).status).toBe(400);
  });
});
