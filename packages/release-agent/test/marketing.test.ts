/** Marketing: the video store, its stage rules, the stage prompts and the HTTP routes. */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { kitSource, Marketing, OUTPUTS, slugify, stageOfRun } from "../console/server/marketing/marketing.ts";
import { stageInstructions, stagePrompt } from "../console/server/marketing/prompts.ts";
import { RunManager } from "../src/runs/runner.ts";
import { MemoryRunStore } from "../src/runs/store.ts";
import { result, scriptedQuery, text, type Script } from "./console/helpers.ts";

const KEY = "sk_" + "a".repeat(40);

function setup(chrome = true) {
  const home = mkdtempSync(path.join(tmpdir(), "marketing-"));
  const store = new Marketing(home, "acme", { chrome });
  store.ensureKit();
  return { home, store };
}

const brief = { title: "Fee Recovery!", feature: "Donors cover the Stripe fee.", story: "Priya, a $50 donation", length: 60, voice: true, music: "warm piano" };

/** Writes a stage's output files, as its session would. */
function produce(store: Marketing, slug: string, ...files: string[]) {
  for (const rel of files) {
    const file = path.join(store.dir, slug, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, rel.endsWith(".md") ? "# Script\n" : "x");
  }
}

const status = (store: Marketing, slug: string) => Object.fromEntries(store.stages(store.brief(slug), null).map((s) => [s.id, s.status]));

describe("the video store", () => {
  it("copies the kit into the shared home once", () => {
    const { home } = setup();
    expect(kitSource()).not.toBeNull();
    expect(existsSync(path.join(home, "kit/src/components/core.tsx"))).toBe(true);
    expect(existsSync(path.join(home, "kit/scripts/voice.mjs"))).toBe(true);
    expect(existsSync(path.join(home, "example/fee-recovery/SCRIPT.md"))).toBe(true);
    expect(JSON.parse(readFileSync(path.join(home, "package.json"), "utf8")).dependencies.remotion).toBeTruthy();
  });

  it("creates a video with a unique slug, and validates the brief", () => {
    const { store } = setup();
    expect(store.create(brief).slug).toBe("fee-recovery");
    expect(store.create(brief).slug).toBe("fee-recovery-2");
    expect(store.list().map((v) => v.slug).sort()).toEqual(["fee-recovery", "fee-recovery-2"]);
    expect(() => store.create({ ...brief, title: "" })).toThrow(/title is required/);
    expect(() => store.create({ ...brief, length: 5 })).toThrow(/15 to 180/);
    expect(slugify("  Ünïcode — & Things  ")).toBe("unicode-things");
  });

  it("holds every step until the script is approved, then opens them in order", () => {
    const { store } = setup();
    store.saveElevenLabsKey(KEY);
    const { slug } = store.create(brief);

    expect(status(store, slug)).toEqual({ script: "ready", music: "blocked", voice: "blocked", build: "blocked", render: "blocked" });

    produce(store, slug, OUTPUTS.script);
    expect(store.stages(store.brief(slug), null).find((s) => s.id === "music")?.reason).toMatch(/Approve the script/);

    store.approve(slug);
    expect(status(store, slug)).toMatchObject({ script: "done", music: "ready", voice: "ready", build: "blocked" });

    produce(store, slug, OUTPUTS.music);
    expect(status(store, slug).build).toBe("blocked"); // voice still missing
    produce(store, slug, OUTPUTS.voiceDurations);
    expect(status(store, slug)).toMatchObject({ build: "ready", render: "blocked" });

    produce(store, slug, OUTPUTS.root, OUTPUTS.review);
    expect(status(store, slug).render).toBe("ready");
    produce(store, slug, OUTPUTS.video(slug));
    expect(store.list()[0]).toMatchObject({ slug, hasVideo: true, progress: "render" });
  });

  it("needs approving again after the script changes", () => {
    const { store } = setup();
    const { slug } = store.create(brief);
    produce(store, slug, OUTPUTS.script);
    store.approve(slug);
    expect(store.detail(slug, null).approved).toBe(true);

    store.saveScript(slug, "# A different script");
    expect(store.detail(slug, null).approved).toBe(false);
    expect(status(store, slug).music).toBe("blocked");
  });

  it("skips the voiceover when the brief has none, and the build doesn't wait for it", () => {
    const { store } = setup();
    const { slug } = store.create({ ...brief, voice: false });
    produce(store, slug, OUTPUTS.script, OUTPUTS.music);
    store.approve(slug);
    expect(status(store, slug)).toMatchObject({ voice: "skipped", build: "ready" });
  });

  it("blocks music without a browser and the voiceover without a key", () => {
    const { store } = setup(false);
    const { slug } = store.create(brief);
    produce(store, slug, OUTPUTS.script);
    store.approve(slug);
    const stages = store.stages(store.brief(slug), null);
    expect(stages.find((s) => s.id === "music")?.reason).toMatch(/no browser/);
    expect(stages.find((s) => s.id === "voice")?.reason).toMatch(/ElevenLabs API key/);
  });

  it("marks the stage a session is running", () => {
    const { store } = setup();
    const { slug } = store.create(brief);
    expect(store.stages(store.brief(slug), { slug, stage: "script" })[0].status).toBe("running");
    expect(stageOfRun("marketing-build")).toBe("build");
    expect(stageOfRun("chat")).toBeNull();
  });

  it("keeps the ElevenLabs key private to this machine", () => {
    const { home, store } = setup();
    expect(() => store.saveElevenLabsKey("not a key")).toThrow(/doesn’t look like/);
    store.saveElevenLabsKey(`  ${KEY}\n`);
    expect(store.elevenLabsKey()).toBe(KEY);
    expect(statSync(path.join(home, "elevenlabs.key")).mode & 0o777).toBe(0o600);
    expect(store.setup().elevenLabs).toBe(true);
    expect(JSON.stringify(store.setup())).not.toContain(KEY);
    store.saveElevenLabsKey("");
    expect(store.setup().elevenLabs).toBe(false);
  });

  it("serves only files inside the video, never hidden ones", () => {
    const { store } = setup();
    const { slug } = store.create(brief);
    produce(store, slug, OUTPUTS.music);
    store.writeInstructions(slug, "script", "secret-ish instructions");

    expect(store.resolveFile(slug, OUTPUTS.music)).toBe(path.join(store.dir, slug, OUTPUTS.music));
    expect(() => store.resolveFile(slug, "../../elevenlabs.key")).toThrow(/outside the video/);
    expect(() => store.resolveFile(slug, ".instructions/script.md")).toThrow(/not shared/);
    expect(() => store.resolveFile(slug, "nope.mp4")).toThrow(/No such file/);
    expect(() => store.resolveFile("../acme", "x")).toThrow(/Invalid video id/);
  });
});

describe("stage prompts", () => {
  const ctx = (overrides = {}) => {
    const { store } = setup();
    const b = store.create(brief);
    return { product: "WP Simple Pay", repo: "/repo", home: store.home, folder: path.join(store.dir, b.slug), brief: b, notes: "", again: false, ...overrides };
  };

  it("asks for a story, the real UI and a voiceover section, and no code", () => {
    const text = stageInstructions("script", ctx());
    expect(text).toContain("WP Simple Pay");
    expect(text).toContain("Donors cover the Stripe fee.");
    expect(text).toMatch(/UI strings in the code/);
    expect(text).toContain("## Voiceover");
    expect(text).toMatch(/Write no code/);
  });

  it("leaves the voiceover section out when the video has none", () => {
    const c = ctx();
    expect(stageInstructions("script", { ...c, brief: { ...c.brief, voice: false } })).not.toContain("## Voiceover");
  });

  it("never lets the voiceover session print the key", () => {
    expect(stageInstructions("voice", ctx())).toMatch(/Never print it, echo it, or write it into any file/);
  });

  it("puts the user's notes first on a re-run", () => {
    const text = stageInstructions("build", ctx({ notes: "Slow down scene 4", again: true }));
    expect(text).toMatch(/Revise what is there/);
    expect(text).toContain("Slow down scene 4");
    expect(text).toContain("composition id is `FeeRecovery`");
  });

  it("keeps the session prompt short and points at the instructions", () => {
    const prompt = stagePrompt("music", "Fee Recovery", "/x/.instructions/music.md", "");
    expect(prompt).toBe('Marketing video "Fee Recovery": pick the music. Read /x/.instructions/music.md and follow it exactly.');
  });
});

// ── the HTTP routes, against a scripted session ───────────────────────────

describe("the /api/marketing routes", () => {
  let server: http.Server;
  let base: string;
  let store: Marketing;
  let calls: Array<{ options: Record<string, unknown> }>;

  const oneTurn: Script = async function* (ctx) {
    await ctx.nextInput();
    yield text("Wrote the script.");
    yield result(0.1);
    await ctx.nextInput();
  };

  beforeAll(async () => {
    const repo = mkdtempSync(path.join(tmpdir(), "marketing-repo-"));
    process.env.RELEASE_REPO = repo;
    process.env.RELEASE_RECIPE = path.resolve("recipes/wpsp-pro.recipe.json");
    const { createApp } = await import("../console/server/http/app.ts");

    ({ store } = setup());
    const scripted = scriptedQuery(oneTurn);
    calls = scripted.calls as never;
    const runs = new RunManager(repo, scripted.queryFn, {}, new MemoryRunStore());
    const allowedHosts: string[] = [];
    server = http.createServer(
      createApp({ root: repo, manager: new RunManager(repo, scripted.queryFn), marketing: { store, runs }, allowedHosts, allowedOrigins: [] })
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as { port: number };
    allowedHosts.push(`127.0.0.1:${port}`);
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(() => server?.close());

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

  it("creates a video, runs its script step and refuses the rest until approved", async () => {
    const created = await post("/api/marketing/videos", brief);
    expect(created.status).toBe(201);
    const slug = created.body.video.brief.slug as string;

    const blocked = await post(`/api/marketing/videos/${slug}/stages/music`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatch(/Write the script first/);

    const started = await post(`/api/marketing/videos/${slug}/stages/script`, { notes: "Make Priya a vet" });
    expect(started.status).toBe(201);
    expect(started.body.run.stageId).toBe("marketing-script");
    expect(started.body.run.prompt).toContain(".instructions/script.md");
    expect(readFileSync(path.join(store.dir, slug, ".instructions/script.md"), "utf8")).toContain("Make Priya a vet");

    // one marketing session at a time
    expect((await post(`/api/marketing/videos/${slug}/stages/script`)).status).toBe(409);

    const run = started.body.run.id as string;
    await until(async () => (await get(`/api/marketing-runs/${run}`)).body.run?.status === "awaiting_reply");
    expect((await get(`/api/marketing/videos/${slug}`)).body.video.stages[0].status).toBe("running");
    expect((await post(`/api/marketing-runs/${run}/finish`)).status).toBe(200);
    expect(calls.length).toBeGreaterThan(0);

    // the session would have written it; approve, then music opens
    expect((await post(`/api/marketing/videos/${slug}/script`, { text: "# Script\n" })).status).toBe(200);
    const approved = await post(`/api/marketing/videos/${slug}/approve`, { approved: true });
    expect(approved.body.video.approved).toBe(true);
    expect(approved.body.video.stages.find((s: { id: string }) => s.id === "music").status).toBe("ready");
  });

  it("never returns the key, and serves media with Range", async () => {
    expect((await post("/api/marketing/setup", { elevenLabsKey: KEY })).body.setup.elevenLabs).toBe(true);
    expect(JSON.stringify((await get("/api/marketing")).body)).not.toContain(KEY);

    const slug = (await post("/api/marketing/videos", { ...brief, title: "Media" })).body.video.brief.slug;
    const file = path.join(store.dir, slug, OUTPUTS.music);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "0123456789");

    const url = `${base}/api/marketing/videos/${slug}/file?path=${encodeURIComponent(OUTPUTS.music)}`;
    const part = await fetch(url, { headers: { Range: "bytes=2-5" } });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-type")).toBe("audio/mpeg");
    expect(await part.text()).toBe("2345");
    expect((await fetch(`${base}/api/marketing/videos/${slug}/file?path=../../elevenlabs.key`)).status).toBe(400);
  });
});
