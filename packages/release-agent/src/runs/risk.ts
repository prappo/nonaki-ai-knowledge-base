/**
 * Risky tool calls.
 *
 * A Bash command matching one of these rules always stops for approval, even
 * when the repo's permission allowlist would let it run. The rules err
 * towards asking: a false positive costs one click, a miss can publish
 * something. A recipe adds product-specific rules (`risk.extra`) and can
 * reword built-in reasons (`risk.messages`).
 *
 * This runs on the agent, not the server: a compromised control server must
 * not be able to waive it.
 */

import type { Recipe } from "../recipe/types.ts";

export interface RiskMatch {
  rule: string;
  reason: string;
  /** Permanent and public (a tag or a release): needs the version typed, not just a click. */
  irreversible: boolean;
}

interface RiskRule {
  rule: string;
  reason: string;
  irreversible?: boolean;
  test: (segment: string) => boolean;
}

const matches = (pattern: RegExp) => (segment: string) => pattern.test(segment);

/**
 * `git tag` with no arguments, `-l`/`--list`, or only flags (such as
 * `--sort=-v:refname`) lists tags. Anything naming a tag writes one.
 */
function isTagWrite(segment: string): boolean {
  const match = segment.match(/\bgit\s+tag\b(.*)$/);
  if (!match) return false;
  const args = match[1].trim().split(/\s+/).filter(Boolean);
  if (args.length === 0 || args.includes("-l") || args.includes("--list")) return false;
  return !args.every((arg) => arg.startsWith("-"));
}

const BUILTIN: RiskRule[] = [
  {
    rule: "git-push-tag",
    reason: "Pushes a tag to a remote repository. Published tags are permanent.",
    irreversible: true,
    test: matches(/\bgit\s+push\b.*(\s--tags\b|\s--follow-tags\b|refs\/tags\/|\s--delete\b|\s:\S)/),
  },
  { rule: "git-push", reason: "Pushes to a remote repository.", test: matches(/\bgit\s+push\b/) },
  { rule: "git-tag", reason: "Creates, moves or deletes a git tag.", irreversible: true, test: isTagWrite },
  { rule: "git-commit", reason: "Creates a commit. The release commands leave committing to you.", test: matches(/\bgit\s+commit\b/) },
  {
    rule: "git-discard",
    reason: "Discards local changes or branches.",
    test: matches(/\bgit\s+(reset\s+--hard|clean\s+-\w*f|branch\s+-D\b|checkout\s+--\s|restore\b|stash\s+(drop|clear)\b)/),
  },
  {
    rule: "gh-release",
    reason: "Creates or changes a public GitHub release.",
    irreversible: true,
    test: matches(/\bgh\s+release\s+(create|delete|edit|upload)\b/),
  },
  {
    rule: "gh-api-release",
    reason: "Writes a GitHub release or tag through the API.",
    irreversible: true,
    test: (segment) =>
      /\bgh\s+api\b/.test(segment) &&
      /\/(releases|git\/refs|git\/tags)\b/.test(segment) &&
      /\s(-X|--method)\s*['"]?(POST|PUT|PATCH|DELETE)\b|\s(-f|-F|--field|--raw-field|--input)\s/i.test(segment),
  },
  {
    rule: "svn-commit",
    reason: "Commits or tags on a remote SVN repository.",
    irreversible: true,
    test: (segment) =>
      /\bsvn\s+(commit|ci)\b/.test(segment) ||
      (/\bsvn\s+(copy|cp|move|mv|mkdir|delete|del|remove|rm|import)\b/.test(segment) && /\bsvn(\+ssh)?:\/\/|\bhttps?:\/\/|\^\//.test(segment)),
  },
  {
    rule: "gh-pr",
    reason: "Changes a GitHub pull request.",
    test: matches(/\bgh\s+pr\s+(create|merge|close|edit|review|comment|ready|reopen)\b/),
  },
  {
    rule: "gh-issue",
    reason: "Changes a GitHub issue.",
    test: matches(/\bgh\s+issue\s+(create|close|edit|comment|delete|reopen|transfer)\b/),
  },
  {
    rule: "gh-api-write",
    reason: "Sends a write request to the GitHub API.",
    test: matches(/\bgh\s+api\b.*(\s(-X|--method)\s*['"]?(POST|PUT|PATCH|DELETE)\b|\s(-f|-F|--field|--raw-field|--input)\s)/i),
  },
  { rule: "prune", reason: "Uses --prune, which deletes things that no longer match.", test: matches(/\s--prune(?![\w-])/) },
  { rule: "rm-recursive", reason: "Deletes files recursively.", test: matches(/\brm\s+(-\w*[rR]\w*|--recursive)\b/) },
  { rule: "npm-publish", reason: "Publishes a package to npm.", test: matches(/\bnpm\s+publish\b/) },
  {
    rule: "curl-write",
    reason: "Sends data to a remote server.",
    test: matches(/\bcurl\b.*(\s(-X|--request)\s*['"]?(POST|PUT|PATCH|DELETE)\b|\s(-d|--data[\w-]*|-F|--form)\s)/i),
  },
];

const BROWSER_RULES = {
  "browser-write": "Sends a write request from your logged-in browser.",
  "browser-send": "Sends or schedules an email from your logged-in browser. A campaign cannot be unsent.",
  "browser-publish": "Publishes a post from your logged-in browser.",
  "browser-submit": "Submits a form in your logged-in browser.",
};

/** Shell rule ids a recipe may position against (`before`) or extend (`alsoMatch`). */
export const BUILTIN_BASH_RULES = BUILTIN.map((r) => r.rule);
/** Every built-in id a recipe may reword (`messages`). */
export const BUILTIN_RISK_RULES = [...BUILTIN_BASH_RULES, ...Object.keys(BROWSER_RULES)];

/** Claude in Chrome's tool for running JavaScript in a page. */
export const BROWSER_SCRIPT_TOOL = "mcp__claude-in-chrome__javascript_tool";

/** Claude in Chrome's tools that act on the page: clicks and keys, batches of them, form fields. */
export const BROWSER_ACTION_TOOLS = [
  "mcp__claude-in-chrome__computer",
  "mcp__claude-in-chrome__browser_batch",
  "mcp__claude-in-chrome__form_input",
];

/** Tools the PreToolUse hook sends to the approval check, as a matcher pattern. */
export const CHECKED_TOOLS = `Bash|AskUserQuestion|${BROWSER_SCRIPT_TOOL}`;

/** The browser action tools, as a second matcher for the same hook. */
export const BROWSER_ACTION_MATCHER = BROWSER_ACTION_TOOLS.join("|");

/** A button or action that sends, schedules or opens the send step of an email campaign. */
const SEND_TARGET =
  /\b(send now|send later|send test( email)?|schedule[sd]?|scheduling|review (&|and) send|save (&|and) review)\b|\bsend(s|ing)? (it|the|this|out)\b|\bsend(s|ing)? (campaign|email|newsletter)\b/i;

/** Clicks and drags: the actions that can press a button. */
const CLICK_ACTIONS = new Set(["left_click", "right_click", "double_click", "triple_click", "left_click_drag", "click"]);

/** Every `{ action, … }` object in a tool input, however deeply a batch nests them. */
function actionsIn(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(actionsIn);
  if (!value || typeof value !== "object") return [];
  const obj = value as Record<string, unknown>;
  const own = typeof obj.action === "string" ? [obj] : [];
  return [...own, ...Object.values(obj).flatMap(actionsIn)];
}

/**
 * Split a command line into the commands it runs, so a rule anchored on one
 * command (`git tag`) isn't confused by the next one in a pipeline.
 */
export function splitCommand(command: string): string[] {
  return command
    .split(/&&|\|\||;|\||\n/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function stringValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (value && typeof value === "object") return Object.values(value).flatMap(stringValues);
  return [];
}

export interface RiskAssessor {
  rules: string[];
  assessBashRisk(command: unknown): RiskMatch | null;
  assessBrowserScriptRisk(input: unknown): RiskMatch | null;
  /** A click in the user's browser on something that sends or schedules. */
  assessBrowserActionRisk(input: unknown): RiskMatch | null;
  /** The risk of any tool call the agent checks, or null when it may run. */
  assessToolRisk(toolName: string, input: unknown): RiskMatch | null;
  /** True when the stage's recipe `forbid` list refuses this rule outright. */
  isForbidden(stageId: string, rule: string): boolean;
  /** The stage's recipe `forbid` list (empty for chats and other stages). */
  forbiddenRules(stageId: string): string[];
}

/** Built-in rules plus the recipe's, in order. */
export function createRiskAssessor(recipe?: Pick<Recipe, "risk"> & Partial<Pick<Recipe, "stages">>): RiskAssessor {
  const messages = recipe?.risk?.messages ?? {};
  const also = recipe?.risk?.alsoMatch ?? {};
  const rules: RiskRule[] = BUILTIN.map((r) => {
    const extra = (also[r.rule] ?? []).map((p) => new RegExp(p));
    return {
      ...r,
      reason: messages[r.rule] ?? r.reason,
      test: extra.length ? (segment: string) => r.test(segment) || extra.some((re) => re.test(segment)) : r.test,
    };
  });

  for (const extra of recipe?.risk?.extra ?? []) {
    const rule: RiskRule = {
      rule: extra.rule,
      reason: extra.reason,
      irreversible: extra.irreversible,
      test: matches(new RegExp(extra.match)),
    };
    const at = extra.before ? rules.findIndex((r) => r.rule === extra.before) : -1;
    if (at === -1) rules.push(rule);
    else rules.splice(at, 0, rule);
  }

  const browserReason = (id: keyof typeof BROWSER_RULES) => messages[id] ?? BROWSER_RULES[id];

  const assessBashRisk = (command: unknown): RiskMatch | null => {
    if (typeof command !== "string" || command.trim() === "") return null;
    for (const segment of splitCommand(command)) {
      for (const rule of rules) {
        if (rule.test(segment)) return { rule: rule.rule, reason: rule.reason, irreversible: rule.irreversible === true };
      }
    }
    return null;
  };

  /**
   * A script run in the user's own logged-in browser that sends a write
   * request. Reads, clicks and screenshots aren't checked.
   */
  const assessBrowserScriptRisk = (input: unknown): RiskMatch | null => {
    const code = stringValues(input).join("\n");
    const sendsRequest = /\b(apiFetch|fetch|XMLHttpRequest|sendBeacon|ajax|axios)\b|\$\.(post|ajax)\b/.test(code);
    const writes = /\bmethod\s*:\s*['"`](POST|PUT|PATCH|DELETE)['"`]/i.test(code) || /\.(post|put|delete)\s*\(/.test(code);
    if (sendsRequest && writes) return { rule: "browser-write", reason: browserReason("browser-write"), irreversible: false };

    // publishing a WordPress post: the Publish button, or a publish status
    const clicksPublish =
      /(getElementById\(\s*['"`]publish['"`]\s*\)|querySelector(All)?\(\s*['"`]#publish['"`]\s*\))\s*(\?\.|!\.|\.)\s*(click|submit|dispatchEvent)\b/.test(code);
    const setsPublishStatus =
      /\b(post_status|status|_status)['"`]?\s*[:=]\s*['"`](publish|future)['"`]/.test(code) || /\.value\s*=\s*['"`](publish|future)['"`]/.test(code);
    // sending an email campaign: clicking a send, schedule or review button
    const clicks = /\.click\s*\(|dispatchEvent\s*\(\s*new\s+(Mouse|Pointer)Event/.test(code);

    if (clicks && /send now|send later|schedule|review & send|save & review|send test/i.test(code)) {
      return { rule: "browser-send", reason: browserReason("browser-send"), irreversible: true };
    }
    // undoing a page's send guard: draft commands disable the send buttons
    // first, marking them "disarmed" and watching with a "SendGuard" observer
    const undoesGuard =
      /SendGuard\w*\s*(\?\.|\.)\s*disconnect\b/i.test(code) ||
      (/disarmed/i.test(code) &&
        (/removeAttribute\s*\(\s*['"`]disabled['"`]/.test(code) ||
          /\.disabled\s*=\s*false\b/.test(code) ||
          /pointerEvents\s*=\s*['"`](auto|)['"`]/.test(code) ||
          /\bdelete\b[^;\n]*[Dd]isarmed/.test(code)));
    if (undoesGuard) return { rule: "browser-send", reason: browserReason("browser-send"), irreversible: true };
    if (clicksPublish || setsPublishStatus) return { rule: "browser-publish", reason: browserReason("browser-publish"), irreversible: true };
    if (/\.submit\s*\(\s*\)/.test(code)) return { rule: "browser-submit", reason: browserReason("browser-submit"), irreversible: false };
    return null;
  };

  /**
   * A click (alone or in a batch) whose description or target names a send,
   * schedule or review-and-send button. A click is described by what it says
   * it does (`action_summary`, `text`), since a coordinate can't be read.
   */
  const assessBrowserActionRisk = (input: unknown): RiskMatch | null => {
    for (const action of actionsIn(input)) {
      if (!CLICK_ACTIONS.has(String(action.action))) continue;
      const described = ["action_summary", "text", "query", "description", "element", "target"]
        .map((k) => action[k])
        .filter((v): v is string => typeof v === "string")
        .join("\n");
      if (SEND_TARGET.test(described)) return { rule: "browser-send", reason: browserReason("browser-send"), irreversible: true };
    }
    return null;
  };

  const forbidden = new Map((recipe?.stages ?? []).map((s) => [s.id, new Set(s.forbid ?? [])]));

  return {
    rules: rules.map((r) => r.rule),
    assessBashRisk,
    assessBrowserScriptRisk,
    assessBrowserActionRisk,
    assessToolRisk(toolName, input) {
      if (toolName === "Bash") return assessBashRisk((input as Record<string, unknown> | null)?.command);
      if (toolName === BROWSER_SCRIPT_TOOL) return assessBrowserScriptRisk(input);
      if (BROWSER_ACTION_TOOLS.includes(toolName)) return assessBrowserActionRisk(input);
      return null;
    },
    isForbidden(stageId, rule) {
      return forbidden.get(stageId)?.has(rule) ?? false;
    },
    forbiddenRules(stageId) {
      return [...(forbidden.get(stageId) ?? [])];
    },
  };
}

/** What the approval card shows for a tool call: the command, or the script. */
export function describeToolCall(toolName: string, input: unknown): string {
  if (toolName === "Bash") return String((input as Record<string, unknown> | null)?.command ?? "");
  return stringValues(input).join("\n");
}
