/**
 * Stage `forbid`: risk rules a stage refuses outright (no approval card), and
 * the browser checks the "Draft email campaign" stage relies on to never send.
 */

import path from "node:path";
import type { HookInput } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, describe, expect, it } from "vitest";
import { loadRecipe, RecipeError, validateRecipe } from "../src/recipe/load.ts";
import { BROWSER_ACTION_MATCHER, CHECKED_TOOLS, createRiskAssessor } from "../src/runs/risk.ts";
import { forceAskHook, setRiskAssessor, stageHook } from "../src/runs/runner.ts";

const recipe = loadRecipe(path.join(import.meta.dirname, "../recipes/wpsp-pro.recipe.json"));
const risk = createRiskAssessor(recipe);

const COMPUTER = "mcp__claude-in-chrome__computer";
const BATCH = "mcp__claude-in-chrome__browser_batch";
const SCRIPT = "mcp__claude-in-chrome__javascript_tool";

const preToolUse = (tool_name: string, tool_input: unknown) =>
  ({ hook_event_name: "PreToolUse", tool_name, tool_input, tool_use_id: "t", session_id: "s", transcript_path: "", cwd: "/repo" }) as HookInput;

afterEach(() => setRiskAssessor(createRiskAssessor()));

describe("browser send checks", () => {
  it("checks Chrome's click and batch tools, not only scripts", () => {
    const hooked = [...CHECKED_TOOLS.split("|"), ...BROWSER_ACTION_MATCHER.split("|")];
    for (const tool of [COMPUTER, BATCH, SCRIPT, "Bash"]) expect(hooked).toContain(tool);
  });

  it("flags a click described as sending or scheduling", () => {
    for (const summary of ["Clicks Send Now", "Opens Review & Send", "Clicks Save & Review", "Schedules the campaign", "Sends the campaign", "Send test email to me"]) {
      expect(risk.assessToolRisk(COMPUTER, { action: "left_click", coordinate: [10, 10], action_summary: summary })?.rule).toBe("browser-send");
    }
  });

  it("flags a send click inside a batch", () => {
    const input = { actions: [{ action: "screenshot" }, { action: "left_click", ref: "ref_9", action_summary: "Click Send Later" }] };
    expect(risk.assessToolRisk(BATCH, input)?.rule).toBe("browser-send");
  });

  it("lets ordinary editor clicks and non-click actions through", () => {
    expect(risk.assessToolRisk(COMPUTER, { action: "left_click", coordinate: [1, 1], action_summary: "Clicks the plain Save button" })).toBeNull();
    expect(risk.assessToolRisk(COMPUTER, { action: "left_click", action_summary: "Adds an Image block to the canvas" })).toBeNull();
    expect(risk.assessToolRisk(COMPUTER, { action: "screenshot" })).toBeNull();
    // typing newsletter text that happens to mention scheduling is not a click
    expect(risk.assessToolRisk(COMPUTER, { action: "type", text: "Schedule recurring payments" })).toBeNull();
  });

  it("flags a script that undoes the send guard, but not the guard itself", () => {
    const undo = [
      "window.__wpspSendGuard.disconnect()",
      "document.querySelectorAll('[data-wpsp-disarmed]').forEach(b => { delete b.dataset.wpspDisarmed; b.removeAttribute('disabled') })",
      "for (const b of document.querySelectorAll('[data-wpsp-disarmed]')) { b.disabled = false; b.style.pointerEvents = 'auto' }",
    ];
    for (const text of undo) expect(risk.assessToolRisk(SCRIPT, { text })?.rule).toBe("browser-send");

    const guard = `button.dataset.wpspDisarmed = '1'; button.setAttribute('disabled', 'disabled'); button.style.pointerEvents = 'none';
      window.__wpspSendGuard = new MutationObserver(disarm); window.__wpspSendGuard.observe(document.body, { childList: true })`;
    expect(risk.assessToolRisk(SCRIPT, { text: guard })).toBeNull();
  });
});

describe("stage forbid", () => {
  it("the Draft email campaign stage forbids sends and page writes", () => {
    expect(risk.isForbidden("email-draft", "browser-send")).toBe(true);
    expect(risk.isForbidden("email-draft", "browser-write")).toBe(true);
    expect(risk.isForbidden("chat", "browser-send")).toBe(false);
  });

  it("denies a forbidden risk in that stage instead of asking", async () => {
    setRiskAssessor(risk);
    const click = preToolUse(COMPUTER, { action: "left_click", coordinate: [5, 5], action_summary: "Click Send Now" });
    const write = preToolUse(SCRIPT, { text: "fetch('/api/campaigns/1/send', { method: 'POST' })" });

    for (const input of [click, write]) {
      expect(await stageHook("email-draft")(input)).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
      // elsewhere it still asks, as before
      expect(await forceAskHook(input)).toMatchObject({ hookSpecificOutput: { permissionDecision: "ask" } });
    }
    expect(await stageHook("email-draft")(preToolUse(COMPUTER, { action: "screenshot" }))).toEqual({});
  });

  it("rejects an unknown rule id in forbid", () => {
    const r = structuredClone(recipe) as unknown as { stages: { id: string; forbid?: string[] }[] };
    r.stages.find((s) => s.id === "email-draft")!.forbid = ["browser-sned"];
    expect(() => validateRecipe(r)).toThrow(RecipeError);
    expect(() => validateRecipe(r)).toThrow(/browser-sned/);
  });
});

describe("session hooks", () => {
  it("adds the Chrome click hook only for a stage with a forbid list", async () => {
    const { RunManager } = await import("../src/runs/runner.ts");
    setRiskAssessor(risk);
    const seen: { stage: string; matchers: string[] }[] = [];
    type Params = { options: { hooks?: { PreToolUse?: { matcher?: string }[] } } };
    const capture = (stage: string) => (params: Params) => {
      seen.push({ stage, matchers: (params.options.hooks?.PreToolUse ?? []).map((m) => m.matcher ?? "") });
      return (async function* () {})();
    };
    for (const stage of ["email-draft", "chat"]) {
      const manager = new RunManager("/repo", capture(stage) as never);
      manager.start(stage, "1.2.3", "/x");
    }
    await new Promise((r) => setTimeout(r, 10));
    expect(seen.find((s) => s.stage === "email-draft")?.matchers).toEqual([CHECKED_TOOLS, BROWSER_ACTION_MATCHER]);
    expect(seen.find((s) => s.stage === "chat")?.matchers).toEqual([CHECKED_TOOLS]);
  });
});
