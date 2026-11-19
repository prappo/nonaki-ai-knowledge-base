/**
 * Content review: checks generated content (the release's marketing copy)
 * before any of it leaves the repo.
 *
 * Two layers, both written to the review's report folder:
 *
 *   checks.json    fixed checks from the recipe's `contentReview.rules`: files
 *                  present, lengths, placeholders, links, images. No AI, so
 *                  they can't get a judgement wrong. Link checks go over the
 *                  network and finish a little later.
 *   reviewer.json  what a read-only Claude Code session found when it read
 *                  everything against the release notes and the house rules.
 *   dismissed.json warnings someone decided to keep, each with a reason.
 *
 * Every report stores a fingerprint of the files it looked at, so changing a
 * file (or the rules) makes the review stale and it has to run again. The
 * review passes when both layers ran on the files as they are now, nothing is
 * a blocker, and every warning was dismissed.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolvePath, type ReleaseContext } from "./context.ts";
import { render, type Vars } from "./template.ts";
import type { ContentFileDef, ContentReviewDef, ContentRuleDef, FindingLevel } from "./types.ts";

export const FINDING_LEVELS: FindingLevel[] = ["blocker", "warning", "note"];

/** At most this many findings per rule and file, so one bad pattern can't flood the report. */
const MAX_PER_RULE = 5;
const MAX_REVIEWER_FINDINGS = 100;

export interface Finding {
  /** Stable across runs while the same text is at fault, so a dismissal sticks. */
  id: string;
  source: "check" | "reviewer";
  /** The rule id, or the reviewer's category. */
  rule: string;
  label: string;
  level: FindingLevel;
  /** A file id from the recipe, or null for the whole set. */
  file: string | null;
  /** The text at fault, exactly as it is in the file. */
  quote: string | null;
  message: string;
  fix: string | null;
  /** Reviewer findings only: whether the quote is really in the file. */
  quoteFound?: boolean;
}

export type LinkStatus = "pending" | "done" | "skipped";

interface ChecksFile {
  version: string;
  at: number;
  fingerprint: string;
  findings: Finding[];
  links: { status: LinkStatus; checked: number; at: number | null };
}

export type ReviewerStatus = "running" | "done" | "unreadable" | "failed";

interface ReviewerFile {
  version: string;
  at: number;
  fingerprint: string;
  runId: string | null;
  status: ReviewerStatus;
  summary: string | null;
  error: string | null;
  findings: Finding[];
}

export interface Dismissal {
  reason: string;
  at: number;
}

export interface ReviewFile {
  id: string;
  label: string;
  /** Relative to the repo when inside it. */
  path: string;
  exists: boolean;
}

export interface ContentReviewState {
  version: string;
  stage: string;
  fixStage: string | null;
  files: ReviewFile[];
  /** The report folder, relative to the repo when inside it. */
  reportDir: string;
  fingerprint: string;
  checks: { ran: boolean; fresh: boolean; at: number | null; links: LinkStatus | null };
  reviewer: {
    ran: boolean;
    fresh: boolean;
    at: number | null;
    runId: string | null;
    status: ReviewerStatus | null;
    summary: string | null;
    error: string | null;
  };
  /** Fresh findings only (a stale layer's findings are left out), blockers first. */
  findings: Array<Finding & { dismissed: Dismissal | null }>;
  counts: { blocker: number; warning: number; note: number; dismissed: number };
  passed: boolean;
  /** Why it hasn't passed, in a sentence, or null. */
  reason: string | null;
}

export class ContentReviewError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

// ── paths and reading ───────────────────────────────────────────────────

export function reviewDef(ctx: ReleaseContext): ContentReviewDef {
  const def = ctx.recipe.contentReview;
  if (!def) throw new ContentReviewError("This recipe has no contentReview.", 404);
  return def;
}

const relativeTo = (root: string, file: string) => {
  const relative = path.relative(root, file);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative : file;
};

function contentDir(ctx: ReleaseContext, def: ContentReviewDef): string {
  return resolvePath(ctx.root, render(def.dir, ctx.vars));
}

export function reportDir(ctx: ReleaseContext, def: ContentReviewDef = reviewDef(ctx)): string {
  return resolvePath(ctx.root, render(def.reportDir, ctx.vars));
}

function filePath(ctx: ReleaseContext, def: ContentReviewDef, file: ContentFileDef): string {
  const rendered = render(file.path, ctx.vars);
  return path.isAbsolute(rendered) ? rendered : path.join(contentDir(ctx, def), rendered);
}

function read(file: string): string | null {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function readJson<T>(file: string): T | null {
  const text = read(file);
  if (text === null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function writeJson(file: string, data: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`);
  renameSync(temp, file);
}

// ── text helpers ────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };

/** Visible text of an HTML snippet: no comments, tags or styles, entities decoded, spaces collapsed. */
export function plainText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#\d+|#x[\da-f]+|[a-z]+);/gi, (whole, code: string) => {
      if (code[0] === "#") {
        const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
      }
      return ENTITIES[code.toLowerCase()] ?? whole;
    })
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n[ \n]*/g, "\n")
    .trim();
}

const squash = (text: string) => text.replace(/\s+/g, " ").trim();

/** The line a match is on, trimmed, so a finding can show where it is. */
function lineAround(text: string, index: number, length: number): string {
  const start = text.lastIndexOf("\n", index) + 1;
  const endAt = text.indexOf("\n", index + length);
  const line = squash(text.slice(start, endAt === -1 ? text.length : endAt));
  return line.length > 220 ? `${line.slice(0, 217)}…` : line;
}

const URL_IN_TEXT = /https?:\/\/[^\s<>"'`)\]]+/g;

function trimUrl(url: string): string {
  return url.replace(/[.,;:!?]+$/, "");
}

interface Link {
  url: string;
  /** href (a link), src (an image or other embed), or text (a bare URL). */
  kind: "href" | "src" | "text";
}

function decodeAttr(value: string): string {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

export function linksIn(content: string, format: ContentFileDef["format"]): Link[] {
  const links: Link[] = [];
  if (format === "html") {
    const withoutComments = content.replace(/<!--[\s\S]*?-->/g, " ");
    for (const match of withoutComments.matchAll(/\b(href|src)\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
      links.push({ url: decodeAttr((match[3] ?? match[4] ?? "").trim()), kind: match[1].toLowerCase() as "href" | "src" });
    }
    return links;
  }
  for (const match of content.matchAll(URL_IN_TEXT)) links.push({ url: trimUrl(match[0]), kind: "text" });
  return links;
}

const isWeb = (url: string) => /^https?:\/\//i.test(url);
/** A merge tag or template variable: not a real URL yet. */
const hasTag = (url: string) => /\{\{|\{%|\*\|/.test(url);

function pageOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${parsed.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

// ── fingerprint ─────────────────────────────────────────────────────────

function localImages(content: string, format: ContentFileDef["format"]): string[] {
  if (format !== "html") return [];
  return linksIn(content, format)
    .filter((link) => link.kind === "src" && !isWeb(link.url) && !/^(data|cid|mailto):/i.test(link.url) && !hasTag(link.url) && link.url !== "")
    .map((link) => link.url.split(/[?#]/)[0]);
}

function hashFile(file: string): string {
  try {
    return createHash("sha256").update(readFileSync(file)).digest("hex");
  } catch {
    return "missing";
  }
}

/** Every file the review reads: the content, the images it uses, the sources and guides, and the rules. */
export function fingerprint(ctx: ReleaseContext, def: ContentReviewDef = reviewDef(ctx)): string {
  const hash = createHash("sha256");
  const files = new Set<string>();

  for (const file of def.files) {
    const full = filePath(ctx, def, file);
    files.add(full);
    const content = read(full);
    if (content !== null) for (const image of localImages(content, file.format)) files.add(path.resolve(path.dirname(full), image));
  }
  for (const source of def.sources ?? []) files.add(resolvePath(ctx.root, render(source, ctx.vars)));
  for (const list of Object.values(def.guides ?? {})) for (const guide of list) files.add(resolvePath(ctx.root, render(guide, ctx.vars)));

  hash.update(JSON.stringify({ rules: def.rules ?? [], files: def.files, instructions: def.instructions ?? "" }));
  for (const file of [...files].sort()) hash.update(`\n${relativeTo(ctx.root, file)}:${hashFile(file)}`);

  return hash.digest("hex").slice(0, 32);
}

// ── fixed checks ────────────────────────────────────────────────────────

function findingId(parts: Array<string | null>): string {
  return createHash("sha256").update(parts.map((part) => part ?? "").join("\u0000")).digest("hex").slice(0, 16);
}

/** `key` tells apart findings on the same text (two placeholders on one line). */
function finding(input: Omit<Finding, "id">, key = ""): Finding {
  return { id: findingId([input.source, input.rule, input.file, input.quote ?? input.message, key]), ...input };
}

interface LoadedFile {
  def: ContentFileDef;
  full: string;
  content: string | null;
}

function load(ctx: ReleaseContext, def: ContentReviewDef): LoadedFile[] {
  return def.files.map((file) => {
    const full = filePath(ctx, def, file);
    return { def: file, full, content: read(full) };
  });
}

function appliesTo(rule: ContentRuleDef, file: ContentFileDef): boolean {
  return rule.files.includes("*") || rule.files.includes(file.id);
}

function regexOf(template: string, vars: Vars, flags: string): RegExp {
  return new RegExp(render(template, vars, "regex"), flags);
}

function withGlobal(flags: string | undefined, fallback: string): string {
  const chosen = flags ?? fallback;
  return chosen.includes("g") ? chosen : `${chosen}g`;
}

const MESSAGE_VARS = ["match", "limit", "length", "problem", "size", "param", "attr", "expected"];

function message(rule: ContentRuleDef, vars: Vars, extra: Record<string, string | number>): string {
  return render(rule.message, { ...vars, ...Object.fromEntries(MESSAGE_VARS.map((name) => [name, ""])), ...extra });
}

function runRule(rule: ContentRuleDef, file: LoadedFile, vars: Vars, out: Finding[]): void {
  const content = file.content!;
  const base = { source: "check" as const, rule: rule.id, label: rule.label, level: rule.level, file: file.def.id, fix: rule.fix ?? null };
  const add = (quote: string | null, extra: Record<string, string | number> = {}) => {
    if (out.filter((item) => item.rule === rule.id && item.file === file.def.id).length >= MAX_PER_RULE) return;
    const item = finding({ ...base, quote, message: message(rule, vars, extra) }, String(extra.match ?? ""));
    if (!out.some((existing) => existing.id === item.id)) out.push(item);
  };

  switch (rule.type) {
    case "forbid": {
      for (const match of content.matchAll(regexOf(rule.regex, vars, withGlobal(rule.flags, "m")))) {
        add(lineAround(content, match.index ?? 0, match[0].length), { match: match[0] });
      }
      return;
    }
    case "require": {
      if (!regexOf(rule.regex, vars, rule.flags ?? "m").test(content)) add(null);
      return;
    }
    case "maxLength": {
      const text = file.def.format === "html" && !rule.capture ? plainText(content) : content;
      let parts: string[];
      if (rule.capture) {
        parts = [...text.matchAll(regexOf(rule.capture, vars, withGlobal(rule.flags, "m")))].map((match) => match[1] ?? "");
      } else if (rule.split) {
        parts = text.split(regexOf(rule.split, vars, rule.flags ?? "m"));
      } else {
        parts = [text];
      }
      for (const raw of parts) {
        let part = rule.ignore ? raw.replace(regexOf(rule.ignore, vars, withGlobal(rule.flags, "m")), "") : raw;
        part = part.trim();
        if (!part) continue;
        const counted = rule.urlLength ? part.replace(URL_IN_TEXT, "x".repeat(rule.urlLength)) : part;
        const length = [...counted].length;
        if (length > rule.max) {
          const quote = squash(part);
          add(quote.length > 220 ? `${quote.slice(0, 217)}…` : quote, { limit: rule.max, length });
        }
      }
      return;
    }
    case "localImages": {
      for (const image of localImages(content, file.def.format)) {
        const full = path.resolve(path.dirname(file.full), image);
        let size: number | null = null;
        try {
          size = statSync(full).size;
        } catch {
          size = null;
        }
        if (size === null) add(image, { match: image, problem: "missing" });
        else if (rule.maxBytes !== undefined && size > rule.maxBytes) {
          const limit = `${(rule.maxBytes / 1024 / 1024).toFixed(1)} MB`;
          add(image, { match: image, size: `${(size / 1024 / 1024).toFixed(1)} MB`, limit, problem: `, over the ${limit} limit` });
        }
      }
      return;
    }
    case "linkParams": {
      const match = regexOf(rule.match, vars, "i");
      for (const link of linksIn(content, file.def.format)) {
        if (link.kind === "src" || !match.test(link.url) || hasTag(link.url)) continue;
        let params: URLSearchParams;
        try {
          params = new URL(link.url).searchParams;
        } catch {
          add(link.url, { match: link.url, param: "" });
          continue;
        }
        const wrong = Object.entries(rule.params).filter(([name, pattern]) => {
          const value = params.get(name);
          return value === null || !new RegExp(`^(?:${pattern})$`).test(value);
        });
        if (wrong.length) add(link.url, { match: link.url, param: wrong.map(([name]) => name).join(", ") });
      }
      return;
    }
    case "linkAttrs": {
      if (file.def.format !== "html") return;
      for (const tag of content.replace(/<!--[\s\S]*?-->/g, " ").matchAll(/<a\b[^>]*>/gi)) {
        const attrs = new Map<string, string>();
        for (const attr of tag[0].matchAll(/([\w-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) attrs.set(attr[1].toLowerCase(), attr[3] ?? attr[4] ?? "");
        const wrong = Object.entries(rule.attrs).filter(([name, value]) => {
          const actual = (attrs.get(name.toLowerCase()) ?? "").split(/\s+/);
          return !value.split(/\s+/).every((token) => actual.includes(token));
        });
        if (wrong.length) add(squash(tag[0]).slice(0, 220), { match: attrs.get("href") ?? "", attr: wrong.map(([name]) => name).join(", ") });
      }
      return;
    }
    // across files or over the network: handled elsewhere
    case "sameLink":
    case "linksOpen":
      return;
  }
}

function sameLink(rule: Extract<ContentRuleDef, { type: "sameLink" }>, files: LoadedFile[], vars: Vars, out: Finding[]): void {
  const match = regexOf(rule.match, vars, "i");
  const pages = new Map<string, { file: string; url: string }[]>();

  for (const file of files) {
    if (file.content === null || !appliesTo(rule, file.def)) continue;
    for (const link of linksIn(file.content, file.def.format)) {
      if (link.kind === "src" || !match.test(link.url) || hasTag(link.url)) continue;
      const page = pageOf(link.url);
      if (!page) continue;
      const list = pages.get(page) ?? [];
      list.push({ file: file.def.id, url: link.url });
      pages.set(page, list);
    }
  }
  if (pages.size < 2) return;

  // the page most files link to is taken as the right one
  const ranked = [...pages.entries()].sort((a, b) => new Set(b[1].map((x) => x.file)).size - new Set(a[1].map((x) => x.file)).size);
  const [expected] = ranked[0];
  for (const [page, uses] of ranked.slice(1)) {
    for (const use of uses) {
      const item = finding({
        source: "check",
        rule: rule.id,
        label: rule.label,
        level: rule.level,
        file: use.file,
        quote: use.url,
        message: message(rule, vars, { match: page, expected }),
        fix: rule.fix ?? null,
      });
      if (!out.some((existing) => existing.id === item.id)) out.push(item);
    }
  }
}

/** The fixed checks that need no network, in a few milliseconds. */
export function runFixedChecks(ctx: ReleaseContext, def: ContentReviewDef = reviewDef(ctx)): Finding[] {
  const files = load(ctx, def);
  const out: Finding[] = [];

  for (const file of files) {
    if (file.content === null) {
      if (!file.def.optional) {
        out.push(
          finding({
            source: "check",
            rule: "file-missing",
            label: "Missing file",
            level: "blocker",
            file: file.def.id,
            quote: null,
            message: `${file.def.label} (${path.basename(file.full)}) doesn't exist.`,
            fix: "Run Write marketing content again, or write the file.",
          })
        );
      }
      continue;
    }
    if (file.content.trim() === "") {
      out.push(
        finding({
          source: "check",
          rule: "file-empty",
          label: "Empty file",
          level: "blocker",
          file: file.def.id,
          quote: null,
          message: `${file.def.label} (${path.basename(file.full)}) is empty.`,
          fix: null,
        })
      );
      continue;
    }
    for (const rule of def.rules ?? []) if (appliesTo(rule, file.def)) runRule(rule, file, ctx.vars, out);
  }
  for (const rule of def.rules ?? []) if (rule.type === "sameLink") sameLink(rule, files, ctx.vars, out);

  return out;
}

export interface LinkTarget {
  url: string;
  rule: Extract<ContentRuleDef, { type: "linksOpen" }>;
  files: string[];
}

/** The web links the `linksOpen` rules check, each once. */
export function linkTargets(ctx: ReleaseContext, def: ContentReviewDef = reviewDef(ctx)): LinkTarget[] {
  const targets = new Map<string, LinkTarget>();
  for (const rule of def.rules ?? []) {
    if (rule.type !== "linksOpen") continue;
    const skip = rule.skip ? regexOf(rule.skip, ctx.vars, "i") : null;
    for (const file of load(ctx, def)) {
      if (file.content === null || !appliesTo(rule, file.def)) continue;
      for (const link of linksIn(file.content, file.def.format)) {
        if (!isWeb(link.url) || hasTag(link.url) || skip?.test(link.url)) continue;
        const key = `${rule.id} ${link.url}`;
        const target = targets.get(key) ?? { url: link.url, rule, files: [] };
        if (!target.files.includes(file.def.id)) target.files.push(file.def.id);
        targets.set(key, target);
      }
    }
  }
  return [...targets.values()];
}

export type FetchLike = (url: string, init: { method: string; redirect: "follow"; signal: AbortSignal; headers: Record<string, string> }) => Promise<{ status: number }>;

/** HEAD, then GET when a server won't answer HEAD. Returns the status, or the error. */
async function probeLink(url: string, fetcher: FetchLike, timeoutMs: number): Promise<{ status: number } | { error: string }> {
  const attempt = async (method: string) => {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    try {
      return await fetcher(url, { method, redirect: "follow", signal: abort.signal, headers: { "User-Agent": "release-agent content review" } });
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    const head = await attempt("HEAD");
    if (head.status < 400) return head;
    return await attempt("GET");
  } catch (error) {
    try {
      return await attempt("GET");
    } catch {
      return { error: error instanceof Error && error.name === "AbortError" ? "timed out" : "couldn't connect" };
    }
  }
}

export async function checkLinks(targets: LinkTarget[], vars: Vars, fetcher: FetchLike = fetch as unknown as FetchLike, timeoutMs = 10_000): Promise<Finding[]> {
  const out: Finding[] = [];
  const queue = [...targets];
  const worker = async () => {
    for (let target = queue.shift(); target; target = queue.shift()) {
      const result = await probeLink(target.url, fetcher, timeoutMs);
      const problem = "error" in result ? result.error : result.status >= 400 ? `answers ${result.status}` : null;
      if (!problem) continue;
      for (const file of target.files) {
        out.push(
          finding({
            source: "check",
            rule: target.rule.id,
            label: target.rule.label,
            level: target.rule.level,
            file,
            quote: target.url,
            message: message(target.rule, vars, { match: target.url, problem }),
            fix: target.rule.fix ?? null,
          })
        );
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, queue.length) }, worker));
  return out;
}

// ── reports ─────────────────────────────────────────────────────────────

const checksFile = (ctx: ReleaseContext, def: ContentReviewDef) => path.join(reportDir(ctx, def), "checks.json");
const reviewerFile = (ctx: ReleaseContext, def: ContentReviewDef) => path.join(reportDir(ctx, def), "reviewer.json");
const dismissedFile = (ctx: ReleaseContext, def: ContentReviewDef) => path.join(reportDir(ctx, def), "dismissed.json");

const version = (ctx: ReleaseContext) => String(ctx.vars.version ?? "");

/**
 * Runs the fixed checks and saves them. With `links`, the link checks run
 * after, and their findings are added when they finish (only if the files
 * haven't changed meanwhile). Returns the promise of that second step.
 */
export function saveFixedChecks(
  ctx: ReleaseContext,
  options: { fetcher?: FetchLike; timeoutMs?: number } = {}
): { links: Promise<void> } {
  const def = reviewDef(ctx);
  const print = fingerprint(ctx, def);
  const targets = linkTargets(ctx, def);
  const report: ChecksFile = {
    version: version(ctx),
    at: Date.now(),
    fingerprint: print,
    findings: runFixedChecks(ctx, def),
    links: { status: targets.length ? "pending" : "skipped", checked: 0, at: null },
  };
  writeJson(checksFile(ctx, def), report);

  if (!targets.length) return { links: Promise.resolve() };

  const links = checkLinks(targets, ctx.vars, options.fetcher, options.timeoutMs).then(
    (found) => {
      const current = readJson<ChecksFile>(checksFile(ctx, def));
      if (!current || current.at !== report.at || fingerprint(ctx, def) !== print) return;
      writeJson(checksFile(ctx, def), { ...current, findings: [...current.findings, ...found], links: { status: "done", checked: targets.length, at: Date.now() } });
    },
    () => {
      const current = readJson<ChecksFile>(checksFile(ctx, def));
      if (!current || current.at !== report.at) return;
      writeJson(checksFile(ctx, def), { ...current, links: { status: "done", checked: 0, at: Date.now() } });
    }
  );
  return { links };
}

/** Marks the reviewer as running for this run, on the files as they are now. */
export function startReviewer(ctx: ReleaseContext, runId: string): void {
  const def = reviewDef(ctx);
  const report: ReviewerFile = {
    version: version(ctx),
    at: Date.now(),
    fingerprint: fingerprint(ctx, def),
    runId,
    status: "running",
    summary: null,
    error: null,
    findings: [],
  };
  writeJson(reviewerFile(ctx, def), report);
}

/** The reviewer's session ended without an answer (stopped, failed). */
export function failReviewer(ctx: ReleaseContext, runId: string, error: string): void {
  const def = reviewDef(ctx);
  const current = readJson<ReviewerFile>(reviewerFile(ctx, def));
  if (!current || current.runId !== runId || current.status !== "running") return;
  writeJson(reviewerFile(ctx, def), { ...current, status: "failed", error });
}

export interface ReviewerAnswer {
  summary: string;
  findings: Array<{ level: FindingLevel; file: string | null; quote: string | null; category: string; problem: string; fix: string | null }>;
}

/** Reads the reviewer's `content_review` block from its final message. */
export function parseReviewerAnswer(text: string): ReviewerAnswer | null {
  const blocks = [...text.matchAll(/```json\s*\n([\s\S]*?)```/g)].map((match) => match[1]).reverse();
  for (const block of blocks) {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(block) as Record<string, unknown>;
    } catch {
      continue;
    }
    const review = data?.content_review as Record<string, unknown> | undefined;
    if (!review || !Array.isArray(review.findings)) continue;
    const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
    return {
      summary: str(review.summary) ?? "",
      findings: review.findings.slice(0, MAX_REVIEWER_FINDINGS).flatMap((raw) => {
        if (typeof raw !== "object" || raw === null) return [];
        const item = raw as Record<string, unknown>;
        const problem = str(item.problem) ?? str(item.message);
        if (!problem) return [];
        const level = FINDING_LEVELS.includes(item.level as FindingLevel) ? (item.level as FindingLevel) : "warning";
        return [{ level, file: str(item.file), quote: str(item.quote), category: str(item.category) ?? "review", problem, fix: str(item.fix) }];
      }),
    };
  }
  return null;
}

const CATEGORY_LABELS: Record<string, string> = {
  facts: "Facts",
  consistency: "Consistency",
  "house-rules": "House rules",
  audience: "Pro vs Lite",
  writing: "Writing",
};

/** Saves the reviewer's answer for its run. A missing or unreadable answer is recorded as such. */
export function saveReviewerAnswer(ctx: ReleaseContext, runId: string, text: string): void {
  const def = reviewDef(ctx);
  const current = readJson<ReviewerFile>(reviewerFile(ctx, def));
  if (!current || current.runId !== runId) return;

  const answer = parseReviewerAnswer(text);
  if (!answer) {
    writeJson(reviewerFile(ctx, def), {
      ...current,
      status: "unreadable",
      error: "The reviewer finished without a content_review block, so its findings couldn't be read. Run the review again.",
    });
    return;
  }

  const files = load(ctx, def);
  const fileOf = (name: string | null) => {
    if (!name) return null;
    const lower = name.toLowerCase();
    return files.find((file) => file.def.id === lower || path.basename(file.full).toLowerCase() === path.basename(lower))?.def ?? null;
  };

  const findings = answer.findings.map((item) => {
    const file = fileOf(item.file);
    const loaded = file ? files.find((entry) => entry.def.id === file.id) : undefined;
    const content = loaded?.content ?? null;
    const quoteFound =
      item.quote === null || content === null
        ? undefined
        : squash(content).includes(squash(item.quote)) || squash(plainText(content)).includes(squash(item.quote));
    return finding({
      source: "reviewer",
      rule: item.category,
      label: CATEGORY_LABELS[item.category] ?? item.category.replace(/(^|-)(\w)/g, (_, dash: string, c: string) => (dash ? " " : "") + c.toUpperCase()),
      level: item.level,
      file: file?.id ?? null,
      quote: item.quote,
      message: item.problem,
      fix: item.fix,
      ...(quoteFound === undefined ? {} : { quoteFound }),
    });
  });

  writeJson(reviewerFile(ctx, def), { ...current, status: "done", summary: answer.summary || null, error: null, findings });
}

export function readDismissals(ctx: ReleaseContext, def: ContentReviewDef = reviewDef(ctx)): Record<string, Dismissal> {
  return readJson<Record<string, Dismissal>>(dismissedFile(ctx, def)) ?? {};
}

/** Keeps a warning or note, with why. Blockers can't be dismissed: they have to be fixed. */
export function dismissFinding(ctx: ReleaseContext, id: string, reason: string): ContentReviewState {
  const def = reviewDef(ctx);
  const state = reviewState(ctx);
  const item = state.findings.find((entry) => entry.id === id);
  if (!item) throw new ContentReviewError("That finding isn't in the current review. Refresh and try again.", 404);
  if (item.level === "blocker") throw new ContentReviewError("Blockers can't be dismissed. Fix the content, then run the review again.");
  const trimmed = reason.trim();
  if (!trimmed) throw new ContentReviewError("Say why this is fine as it is.");
  writeJson(dismissedFile(ctx, def), { ...readDismissals(ctx, def), [id]: { reason: trimmed.slice(0, 500), at: Date.now() } });
  return reviewState(ctx);
}

export function undismissFinding(ctx: ReleaseContext, id: string): ContentReviewState {
  const def = reviewDef(ctx);
  const dismissals = readDismissals(ctx, def);
  delete dismissals[id];
  writeJson(dismissedFile(ctx, def), dismissals);
  return reviewState(ctx);
}

const LEVEL_ORDER: Record<FindingLevel, number> = { blocker: 0, warning: 1, note: 2 };
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Where the review is for this version. Cheap and offline: stage status calls it on every request. */
export function reviewState(ctx: ReleaseContext): ContentReviewState {
  const def = reviewDef(ctx);
  const print = fingerprint(ctx, def);
  const checks = readJson<ChecksFile>(checksFile(ctx, def));
  const reviewer = readJson<ReviewerFile>(reviewerFile(ctx, def));
  const dismissals = readDismissals(ctx, def);
  const v = version(ctx);

  const checksFresh = Boolean(checks && checks.version === v && checks.fingerprint === print);
  const reviewerFresh = Boolean(reviewer && reviewer.version === v && reviewer.fingerprint === print);

  const findings = [...(checksFresh ? checks!.findings : []), ...(reviewerFresh ? reviewer!.findings : [])]
    .map((item) => ({ ...item, dismissed: item.level !== "blocker" ? dismissals[item.id] ?? null : null }))
    .sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || Number(Boolean(a.dismissed)) - Number(Boolean(b.dismissed)));

  const open = findings.filter((item) => !item.dismissed);
  const counts = {
    blocker: open.filter((item) => item.level === "blocker").length,
    warning: open.filter((item) => item.level === "warning").length,
    note: open.filter((item) => item.level === "note").length,
    dismissed: findings.length - open.length,
  };

  let reason: string | null = null;
  if (!checks && !reviewer) reason = "The review hasn't run yet.";
  else if (!checksFresh || !reviewerFresh) {
    const changed = (checks?.version === v && !checksFresh) || (reviewer?.version === v && !reviewerFresh);
    reason = changed ? "The content changed since the last review. Run the review again." : "The review hasn't run on this version's content yet.";
  } else if (checks!.links.status === "pending") reason = "The link checks are still running.";
  else if (reviewer!.status === "running") reason = "The reviewer is still reading.";
  else if (reviewer!.status !== "done") reason = reviewer!.error ?? "The reviewer didn't finish. Run the review again.";
  else if (counts.blocker) reason = `${plural(counts.blocker, "blocker")} to fix${counts.warning ? `, and ${plural(counts.warning, "warning")} to fix or dismiss` : ""}.`;
  else if (counts.warning) reason = `${plural(counts.warning, "warning")} to fix or dismiss.`;

  return {
    version: v,
    stage: def.stage,
    fixStage: def.fixStage ?? null,
    files: def.files.map((file) => {
      const full = filePath(ctx, def, file);
      return { id: file.id, label: file.label, path: relativeTo(ctx.root, full), exists: existsSync(full) };
    }),
    reportDir: relativeTo(ctx.root, reportDir(ctx, def)),
    fingerprint: print,
    checks: { ran: Boolean(checks), fresh: checksFresh, at: checks?.at ?? null, links: checks?.links.status ?? null },
    reviewer: {
      ran: Boolean(reviewer),
      fresh: reviewerFresh,
      at: reviewer?.at ?? null,
      runId: reviewer?.runId ?? null,
      status: reviewer?.status ?? null,
      summary: reviewer?.summary ?? null,
      error: reviewer?.error ?? null,
    },
    findings,
    counts,
    passed: reason === null,
    reason,
  };
}

export function reviewPassed(ctx: ReleaseContext): boolean {
  return ctx.recipe.contentReview ? reviewState(ctx).passed : false;
}

// ── prompts ─────────────────────────────────────────────────────────────

function list(items: string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

/** What the read-only reviewer session is told. Owned by the console, not the repo, so the writer can't change its grader. */
export function reviewerPrompt(ctx: ReleaseContext): string {
  const def = reviewDef(ctx);
  const files = load(ctx, def);
  const fixed = runFixedChecks(ctx, def);
  const sources = (def.sources ?? []).map((source) => relativeTo(ctx.root, resolvePath(ctx.root, render(source, ctx.vars))));
  const guides = Object.entries(def.guides ?? {}).flatMap(([id, paths]) =>
    paths.map((guide) => `${id}: ${relativeTo(ctx.root, resolvePath(ctx.root, render(guide, ctx.vars)))}`)
  );

  return `You are the content reviewer for release ${version(ctx)}. Another session wrote this release's marketing content. Read all of it and find what is wrong before anything is published or sent. You are a reviewer, not an editor: you can't change any file, so don't try. Don't ask questions; review what is there.

## The content (file id: path)
${list(files.map((file) => `${file.def.id}: ${relativeTo(ctx.root, file.full)} (${file.def.label})${file.content === null ? " — MISSING" : ""}`))}

## What it must be true to
${sources.length ? list(sources) : "- (no sources given: judge from the content and the code in this repo)"}
Every claim about the release must match a real change in these. You may also read the code in this repo to check a claim.

## House rules for each piece
${guides.length ? list(guides) : "- (none given)"}
These docs are the instructions the writer followed. Check each piece against its own rules.

## Check for
1. facts: a feature, number, setting or fix that isn't in the release, is overstated, or is described wrongly. Wrong version numbers.
2. consistency: the pieces tell different stories, use different names for the same thing, or link to different pages for the same thing.
3. house-rules: a piece breaks a rule in its own guide (tone, structure, what it must or mustn't say).
4. audience: Pro-only features presented to Lite users as theirs, or the other way round. Wrong plan names.
5. writing: spelling, grammar, broken sentences, unclear wording, awkward or robotic phrasing, leftovers from a draft.
${def.instructions ? `\n## Also\n${def.instructions}\n` : ""}
## Already found by the fixed checks (don't repeat these)
${fixed.length ? list(fixed.map((item) => `[${item.level}] ${item.file ?? "all"}: ${item.message}`)) : "- nothing"}
Lengths, placeholders, merge tags, link tracking and dead links are checked by code; focus on what needs judgement.

## Levels
- blocker: must not go out like this: a false claim, the wrong version, the wrong audience, a broken promise to customers.
- warning: should be fixed: a house-rule break, an inconsistency, a clear writing mistake.
- note: a suggestion. Use notes sparingly.

## Your answer
Report only real problems, each once, with the exact text at fault copied from the file (\`quote\`, short, character for character) so it can be found. If everything is fine, say so with an empty list. End your final message with exactly one fenced json block:

\`\`\`json
{
  "content_review": {
    "summary": "One or two sentences on the content's state.",
    "findings": [
      { "level": "blocker", "file": "newsletter", "category": "facts", "quote": "exact text from the file", "problem": "What is wrong and why.", "fix": "What it should say instead." }
    ]
  },
  "release_console": { "status": "ok", "summary": "Reviewed N files: X blockers, Y warnings, Z notes.", "files": [], "followups": [] }
}
\`\`\`

\`file\` is a file id from the list above (or null for the set as a whole). \`category\` is one of facts, consistency, house-rules, audience, writing.`;
}

/** What the fixing session is told: the open findings, and to change only the content. */
export function fixPrompt(ctx: ReleaseContext): string {
  const def = reviewDef(ctx);
  const state = reviewState(ctx);
  const open = state.findings.filter((item) => !item.dismissed && item.level !== "note");
  if (!open.length) throw new ContentReviewError("Nothing to fix: no open blockers or warnings in the current review.", 409);
  const pathOf = (id: string | null) => state.files.find((file) => file.id === id)?.path ?? "(the set as a whole)";
  const guides = Object.entries(def.guides ?? {}).flatMap(([id, paths]) =>
    paths.map((guide) => `${id}: ${relativeTo(ctx.root, resolvePath(ctx.root, render(guide, ctx.vars)))}`)
  );

  return `Fix the problems the content review found in release ${version(ctx)}'s marketing content.

## Findings to fix
${open
  .map(
    (item, index) =>
      `${index + 1}. [${item.level}] ${pathOf(item.file)} — ${item.label}: ${item.message}${item.quote ? `\n   Text: "${item.quote}"` : ""}${item.fix ? `\n   Suggested fix: ${item.fix}` : ""}`
  )
  .join("\n")}

## Rules
- Change only the content files above. Don't touch ${state.reportDir}/ (the review's own reports).
- Keep each piece within its house rules:
${guides.length ? list(guides) : "- (none given)"}
- Fix each finding where it is; if one is wrong (the content is right), leave it and say why.
- Keep the other pieces consistent with what you change (the same link, the same names).
- Don't publish, send or post anything.

When you're done, list what you changed per finding. The review then has to run again on the new content. End with:

\`\`\`json
{ "release_console": { "status": "ok", "summary": "Fixed N of M findings.", "files": [], "followups": ["Run Check marketing content again."] } }
\`\`\``;
}
