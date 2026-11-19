/**
 * Content review: the WPSP recipe's fixed checks, the reviewer's answer, the
 * report's freshness, dismissals, and the gate it puts on the draft stages.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkLinks,
  ContentReviewError,
  dismissFinding,
  fixPrompt,
  linkTargets,
  parseReviewerAnswer,
  plainText,
  reviewerPrompt,
  reviewState,
  runFixedChecks,
  saveFixedChecks,
  saveReviewerAnswer,
  startReviewer,
  undismissFinding,
  type FetchLike,
} from "../src/recipe/contentReview.ts";
import { createContext, type ReleaseContext } from "../src/recipe/context.ts";
import { openRecipe, validateRecipe } from "../src/recipe/load.ts";
import { stageStates } from "../src/recipe/stages.ts";

const opened = await openRecipe(path.join(import.meta.dirname, "../recipes/wpsp-pro.recipe.json"));
const { recipe, hooks } = opened;

const BLOG = "https://wpsimplepay.com/introducing-wp-simple-pay-4-17-5-faster-checkout/";
const utm = (campaign: string) =>
  `https://wpsimplepay.com/changelog/?utm_source=WordPress&amp;utm_campaign=${campaign}&amp;utm_medium=notification-inbox&amp;utm_content=%5BNEW%5D`;

/** Content that passes every fixed check. */
const CLEAN: Record<string, string> = {
  "blog.html": `<h1>WP Simple Pay 4.17.5</h1><p>Checkout is faster on phones.</p><img src="blog/shot.png" alt="">`,
  "newsletter.html": `<!--
Subject line: A faster checkout on every phone
Preview text: Our update makes checkout feel easier. Nothing to set up.
-->
<table><tr><td><p>WP Simple Pay 4.17.5</p><h1>Hi {{ Contact:firstName|"there" }} 👋</h1>
<a href="${BLOG}?utm_source=newsletter">Read the post</a><p>{{ Account:FullAddress }}</p></td></tr></table>`,
  "twitter.txt": `=== SINGLE TWEET ===

Checkout just got faster on every phone 📱 ${BLOG}

(X-effective length: ~70 chars)

=== THREAD ===

--- Tweet 1 ---

WP Simple Pay 4.17.5 is out 🧵

(X-effective length: ~30 chars)
`,
  "linkedin.txt": `Your checkout, faster.\n\nRead more: ${BLOG}`,
  "slack-pro.txt": "Hey team, WP Simple Pay Pro 4.17.5 is live!",
  "slack-lite.txt": "Hey team, WP Simple Pay Lite 4.17.5 is live!",
  "notification-pro.html": `Title: [NEW] Faster checkout\n<p>Pro 4.17.5</p><a href="${utm("pro-plugin")}" target="_blank" rel="noopener noreferrer">Changelog</a>`,
  "notification-lite.html": `Title: [NEW] Faster checkout\n<p>Lite 4.17.5</p><a href="${utm("lite-plugin")}" target="_blank" rel="noopener noreferrer">Changelog</a>`,
  "release.md": "# 4.17.5\n\n- Faster checkout on phones.\n",
};

const ok: FetchLike = async () => ({ status: 200 });

let root: string;
let ctx: ReleaseContext;
const dir = () => path.join(root, "docs/releases/4.17.5");
const write = (name: string, content: string) => {
  mkdirSync(path.dirname(path.join(dir(), name)), { recursive: true });
  writeFileSync(path.join(dir(), name), content);
};
const answer = (findings: unknown[], summary = "Looks good.") =>
  "Done.\n\n```json\n" +
  JSON.stringify({ content_review: { summary, findings }, release_console: { status: "ok", summary: "Reviewed", files: [], followups: [] } }) +
  "\n```";

/** Runs both layers, with links answering 200 and the reviewer answering `findings`. */
async function review(findings: unknown[] = []) {
  await saveFixedChecks(ctx, { fetcher: ok }).links;
  startReviewer(ctx, "run-1");
  saveReviewerAnswer(ctx, "run-1", answer(findings));
  return reviewState(ctx);
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "content-review-"));
  for (const [name, content] of Object.entries(CLEAN)) write(name, content);
  write("blog/shot.png", "png");
  write("blog-4.17.5-featured-image.jpg", "jpg");
  ctx = createContext(recipe, root, "4.17.5")!;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const rules = (findings: { rule: string; file: string | null }[]) => findings.map((item) => `${item.file}:${item.rule}`);

describe("fixed checks", () => {
  it("finds nothing in clean content", () => {
    expect(runFixedChecks(ctx)).toEqual([]);
  });

  it("reports missing and empty files as blockers", () => {
    rmSync(path.join(dir(), "twitter.txt"));
    write("linkedin.txt", "  \n");
    const found = runFixedChecks(ctx);
    expect(rules(found)).toEqual(["twitter:file-missing", "linkedin:file-empty"]);
    expect(found.every((item) => item.level === "blocker")).toBe(true);
  });

  it("catches placeholders, broken merge tags and a missing version", () => {
    write("newsletter.html", CLEAN["newsletter.html"].replace("4.17.5", "4.17.4").replace("Read the post", "TODO read [link]").replace('{{ Contact:firstName|"there" }}', "{{ firstName }}"));
    const found = runFixedChecks(ctx);
    expect(rules(found).sort()).toEqual(["newsletter:merge-tags", "newsletter:placeholders", "newsletter:placeholders", "newsletter:version"]);
    expect(found.find((item) => item.rule === "placeholders")!.message).toContain('"TODO"');
  });

  it("checks the subject and preview text", () => {
    write("newsletter.html", CLEAN["newsletter.html"].replace("A faster checkout on every phone", "x".repeat(90)).replace(/Preview text:.*\n/, ""));
    const found = runFixedChecks(ctx);
    expect(rules(found)).toEqual(["newsletter:subject-length", "newsletter:preview"]);
    expect(found[0].message).toBe("The subject line is 90 characters; inboxes cut it off after about 70.");
  });

  it("counts each tweet as X does: links as 23, notes left out", () => {
    const long = `${"word ".repeat(52)}${BLOG}`; // 260 + 23 = 283
    write("twitter.txt", CLEAN["twitter.txt"].replace(`Checkout just got faster on every phone 📱 ${BLOG}`, long));
    const found = runFixedChecks(ctx);
    expect(rules(found)).toEqual(["twitter:tweet-length"]);
    expect(found[0].message).toContain("283 characters");

    write("twitter.txt", CLEAN["twitter.txt"].replace(`Checkout just got faster on every phone 📱 ${BLOG}`, `${"word ".repeat(50)}${BLOG}`)); // 273
    expect(runFixedChecks(ctx)).toEqual([]);
  });

  it("checks notification link tracking and new-tab links", () => {
    write("notification-lite.html", CLEAN["notification-lite.html"].replace("lite-plugin", "pro-plugin").replace(' target="_blank"', ""));
    const found = runFixedChecks(ctx);
    expect(rules(found)).toEqual(["notification-lite:notification-utm-lite", "notification-lite:notification-new-tab"]);
    expect(found[0].message).toContain("utm_campaign");
    expect(found[1].message).toContain("target");
  });

  it("flags a piece that links to a different blog post", () => {
    write("linkedin.txt", `Read more: https://wpsimplepay.com/introducing-wp-simple-pay-4-17-4-old/`);
    const found = runFixedChecks(ctx);
    expect(rules(found)).toEqual(["linkedin:same-blog-link"]);
    expect(found[0].message).toContain(BLOG.replace(/\/$/, ""));
  });

  it("checks local images exist and aren't too big", () => {
    write("blog.html", CLEAN["blog.html"] + '<img src="blog/missing.gif">');
    write("newsletter.html", CLEAN["newsletter.html"] + '<img src="newsletter/big.gif">');
    write("newsletter/big.gif", "x".repeat(2 * 1024 * 1024 + 1));
    const found = runFixedChecks(ctx);
    expect(found.map((item) => item.message)).toEqual(["Image blog/missing.gif is missing.", "Image newsletter/big.gif is 2.0 MB, over the 2.0 MB limit."]);
  });

  it("checks links over the network, skipping the unpublished blog post", async () => {
    write("linkedin.txt", `${CLEAN["linkedin.txt"]}\nDocs: https://wpsimplepay.com/doc/gone`);
    const targets = linkTargets(ctx);
    expect(targets.map((target) => target.url).sort()).toEqual([
      "https://wpsimplepay.com/changelog/?utm_source=WordPress&utm_campaign=lite-plugin&utm_medium=notification-inbox&utm_content=%5BNEW%5D",
      "https://wpsimplepay.com/changelog/?utm_source=WordPress&utm_campaign=pro-plugin&utm_medium=notification-inbox&utm_content=%5BNEW%5D",
      "https://wpsimplepay.com/doc/gone",
    ]);
    const methods: string[] = [];
    const fetcher: FetchLike = async (url, init) => {
      methods.push(init.method);
      return { status: url.endsWith("/gone") ? 404 : 200 };
    };
    const found = await checkLinks(targets, ctx.vars, fetcher);
    expect(found.map((item) => `${item.file} ${item.message}`)).toEqual(["linkedin https://wpsimplepay.com/doc/gone answers 404."]);
    // a failing HEAD is tried again with GET before it counts
    expect(methods.filter((m) => m === "GET")).toHaveLength(1);
  });

  it("strips HTML to its visible text", () => {
    expect(plainText("<!-- Subject: x --><p>Hi&nbsp;<b>there</b> &amp; you</p><style>p{}</style>")).toBe("Hi there & you");
  });
});

describe("the reviewer's answer", () => {
  it("reads the content_review block and checks each quote is really in the file", () => {
    const parsed = parseReviewerAnswer(answer([{ level: "blocker", file: "newsletter", category: "facts", quote: "q", problem: "p", fix: "f" }, { level: "weird", problem: "no level" }, { level: "note" }]));
    expect(parsed!.findings).toEqual([
      { level: "blocker", file: "newsletter", quote: "q", category: "facts", problem: "p", fix: "f" },
      { level: "warning", file: null, quote: null, category: "review", problem: "no level", fix: null },
    ]);
    expect(parseReviewerAnswer("no json here")).toBeNull();
  });

  it("saves findings with labels, matching files by id or name", async () => {
    const state = await review([
      { level: "warning", file: "newsletter.html", category: "writing", quote: "Read   the post", problem: "Vague call to action." },
      { level: "note", file: "blog", category: "facts", quote: "made up text", problem: "Hm." },
    ]);
    expect(state.findings.map((item) => [item.file, item.label, item.quoteFound])).toEqual([
      ["newsletter", "Writing", true],
      ["blog", "Facts", false],
    ]);
    expect(state.reviewer.summary).toBe("Looks good.");
  });

  it("records an answer it can't read", async () => {
    await saveFixedChecks(ctx, { fetcher: ok }).links;
    startReviewer(ctx, "run-1");
    saveReviewerAnswer(ctx, "run-1", "I reviewed it, all fine.");
    const state = reviewState(ctx);
    expect(state.reviewer.status).toBe("unreadable");
    expect(state.passed).toBe(false);
    expect(state.reason).toContain("content_review");
  });

  it("ignores an answer from another run", async () => {
    await saveFixedChecks(ctx, { fetcher: ok }).links;
    startReviewer(ctx, "run-2");
    saveReviewerAnswer(ctx, "run-1", answer([]));
    expect(reviewState(ctx).reason).toBe("The reviewer is still reading.");
  });
});

describe("passing", () => {
  it("passes when both layers ran on the current files and nothing is open", async () => {
    expect(reviewState(ctx)).toMatchObject({ passed: false, reason: "The review hasn't run yet." });
    expect(await review()).toMatchObject({ passed: true, reason: null, counts: { blocker: 0, warning: 0, note: 0, dismissed: 0 } });
  });

  it("waits for the link checks", async () => {
    const waiting: Array<() => void> = [];
    const slow: FetchLike = () => new Promise((resolve) => waiting.push(() => resolve({ status: 200 })));
    const { links } = saveFixedChecks(ctx, { fetcher: slow });
    startReviewer(ctx, "run-1");
    saveReviewerAnswer(ctx, "run-1", answer([]));
    expect(reviewState(ctx).reason).toBe("The link checks are still running.");
    await new Promise((resolve) => setImmediate(resolve));
    for (const resolve of waiting) resolve();
    await links;
    expect(reviewState(ctx).passed).toBe(true);
  });

  it("goes stale when a file, image or source changes", async () => {
    expect((await review()).passed).toBe(true);
    write("twitter.txt", CLEAN["twitter.txt"] + "\n");
    expect(reviewState(ctx)).toMatchObject({ passed: false, reason: "The content changed since the last review. Run the review again.", findings: [] });

    expect((await review()).passed).toBe(true);
    write("blog/shot.png", "new png");
    expect(reviewState(ctx).passed).toBe(false);

    expect((await review()).passed).toBe(true);
    write("release.md", "# changed");
    expect(reviewState(ctx).passed).toBe(false);
  });

  it("is per version: another version's report doesn't count", async () => {
    expect((await review()).passed).toBe(true);
    const hotfix = createContext(recipe, root, "4.17.5.1")!;
    expect(reviewState(hotfix)).toMatchObject({ passed: false, reason: "The review hasn't run on this version's content yet." });
  });

  it("blocks on a blocker, which can't be dismissed", async () => {
    const state = await review([{ level: "blocker", file: "blog", category: "facts", quote: "faster", problem: "Not in the release." }]);
    expect(state).toMatchObject({ passed: false, reason: "1 blocker to fix.", counts: { blocker: 1 } });
    expect(() => dismissFinding(ctx, state.findings[0].id, "fine")).toThrow(ContentReviewError);
  });

  it("passes once every warning is dismissed with a reason, and the dismissal survives a re-run", async () => {
    const state = await review([{ level: "warning", file: "linkedin", category: "house-rules", quote: "Your checkout, faster.", problem: "Hook too short." }, { level: "note", problem: "Could add an emoji." }]);
    expect(state.reason).toBe("1 warning to fix or dismiss.");
    const id = state.findings[0].id;
    expect(() => dismissFinding(ctx, id, "  ")).toThrow("Say why");

    expect(dismissFinding(ctx, id, "Short on purpose.")).toMatchObject({ passed: true, counts: { warning: 0, note: 1, dismissed: 1 } });
    // same text at fault next run: still dismissed
    const again = await review([{ level: "warning", file: "linkedin", category: "house-rules", quote: "Your checkout, faster.", problem: "Worded differently this time." }]);
    expect(again.passed).toBe(true);
    expect(again.findings[0].dismissed?.reason).toBe("Short on purpose.");

    expect(undismissFinding(ctx, id).passed).toBe(false);
  });
});

describe("prompts", () => {
  it("tells the reviewer the files, sources, guides and what the checks found", () => {
    write("linkedin.txt", "TODO");
    const prompt = reviewerPrompt(ctx);
    expect(prompt).toContain("newsletter: docs/releases/4.17.5/newsletter.html (Newsletter)");
    expect(prompt).toContain("- docs/releases/4.17.5/release.md");
    expect(prompt).toContain("newsletter: .claude/commands/wpsp-marketing-newsletter.md");
    expect(prompt).toContain('[blocker] linkedin: Draft placeholder "TODO" is still in the text.');
    expect(prompt).toContain('"content_review"');
  });

  it("gives the fixer the open findings only", async () => {
    const state = await review([
      { level: "warning", file: "blog", category: "writing", quote: "Checkout is faster", problem: "Say how much faster." },
      { level: "warning", file: "linkedin", category: "writing", quote: "Read more", problem: "Kept." },
    ]);
    dismissFinding(ctx, state.findings.find((item) => item.file === "linkedin")!.id, "fine");
    const prompt = fixPrompt(ctx);
    expect(prompt).toContain("1. [warning] docs/releases/4.17.5/blog.html — Writing: Say how much faster.");
    expect(prompt).not.toContain("Kept.");
    expect(prompt).toContain("Don't touch docs/releases/4.17.5/marketing-review/");

    dismissFinding(ctx, state.findings.find((item) => item.file === "blog")!.id, "fine");
    expect(() => fixPrompt(ctx)).toThrow("Nothing to fix");
  });
});

describe("the pipeline", () => {
  const status = (id: string) => stageStates(ctx, { hooks, probes: {} }).find((stage) => stage.id === id)!;

  it("puts the review right after Write marketing content", () => {
    const ids = recipe.stages.map((stage) => stage.id);
    expect(ids.indexOf("marketing-review")).toBe(ids.indexOf("marketing") + 1);
    expect(status("marketing-review")).toMatchObject({ contentReview: true, review: { type: "contentReview" }, status: "ready", tracked: true });
  });

  it("holds the draft stages until the review passes", async () => {
    for (const id of ["blog-draft", "email-draft", "notifications-draft"]) {
      expect(status(id).status, id).toBe("blocked");
      expect(status(id).blockedReason, id).toContain("Check marketing content");
    }
    await review();
    expect(status("marketing-review").status).toBe("done");
    expect(status("email-draft").status).toBe("ready");

    write("newsletter.html", CLEAN["newsletter.html"] + " ");
    expect(status("email-draft").status).toBe("blocked");
  });

  it("is blocked until there is content", () => {
    rmSync(path.join(dir(), "blog.html"));
    rmSync(path.join(dir(), "newsletter.html"));
    expect(status("marketing-review").status).toBe("blocked");
  });
});

describe("recipe validation", () => {
  const raw = () => JSON.parse(JSON.stringify(recipe));

  it("rejects a gate on a review the recipe doesn't have", () => {
    const r = raw();
    delete r.contentReview;
    expect(() => validateRecipe(r)).toThrow(/no `contentReview`/);
  });

  it("rejects unknown rule types, file ids and broken patterns", () => {
    const r = raw();
    r.contentReview.rules.push(
      { id: "a", label: "A", level: "warning", files: ["nope"], type: "forbid", regex: "(", message: "m" },
      { id: "b", label: "B", level: "bad", files: ["*"], type: "spell", message: "m" }
    );
    expect(() => validateRecipe(r)).toThrow(/unknown file id "nope"[\s\S]*invalid regex[\s\S]*level[\s\S]*type: must be one of/);
  });
});
