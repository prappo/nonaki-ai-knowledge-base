/** Switching Claude in Chrome on or off in an Agent chat: the same session, restarted as the other stage. */

import { describe, expect, it } from "vitest";
import { RunManager, type RunSnapshot } from "../src/runs/runner.ts";
import { MemoryRunStore } from "../src/runs/store.ts";
import { result, scriptedQuery, text, waitFor, type Script } from "./console/helpers.ts";

const SESSION = "session-1";

const oneTurn: Script = async function* (ctx) {
  await ctx.nextInput();
  yield text("Done.");
  yield result(0.1);
  await ctx.nextInput();
};

function saved(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    stageId: "chat",
    version: "session",
    prompt: "remove the video from the blog post",
    status: "done",
    error: null,
    startedAt: 100,
    endedAt: 100,
    sessionId: SESSION,
    costUsd: 0.2,
    files: [],
    items: [],
    gates: [],
    resumedFrom: null,
    outcome: null,
    ...overrides,
  } as RunSnapshot;
}

function setup(existing: RunSnapshot[] = []) {
  const store = new MemoryRunStore();
  for (const run of existing) store.save(run);
  const scripted = scriptedQuery(oneTurn);
  const stages: string[] = [];
  const manager = new RunManager(
    "/repo",
    scripted.queryFn,
    (stageId) => {
      stages.push(stageId);
      return stageId === "chat-chrome" ? { extraArgs: { chrome: null } } : {};
    },
    store,
  );
  return { store, scripted, stages, manager };
}

describe("switching Chrome in a chat", () => {
  it("resumes an ended chat as chat-chrome, with Chrome attached and the same session", async () => {
    const { scripted, stages, manager } = setup([saved()]);

    const run = manager.resume(saved().id, "now use the browser", { stageId: "chat-chrome" });
    await waitFor(() => run.status === "awaiting_reply");

    expect(run.stageId).toBe("chat-chrome");
    expect(stages).toEqual(["chat-chrome"]);
    expect(scripted.calls[0].options.resume).toBe(SESSION);
    expect(scripted.calls[0].options.extraArgs).toEqual({ chrome: null });
  });

  it("keeps the stage when no switch is asked for", async () => {
    const { stages, manager } = setup([saved()]);

    const run = manager.resume(saved().id, "go on");
    await waitFor(() => run.status === "awaiting_reply");
    expect(run.stageId).toBe("chat");
    expect(stages).toEqual(["chat"]);
  });

  it("finishes a chat waiting for a reply, then picks it up with Chrome", async () => {
    const { scripted, manager } = setup();
    const first = manager.start("chat", "session", "remove the video");
    await waitFor(() => first.status === "awaiting_reply" && first.sessionId !== null);

    const second = manager.resume(first.id, "use Chrome for this", { stageId: "chat-chrome" });
    await waitFor(() => second.status === "awaiting_reply");

    expect(first.status).toBe("done");
    expect(second.resumedFrom).toBe(first.id);
    expect(second.stageId).toBe("chat-chrome");
    expect(scripted.calls[1].options.resume).toBe(first.sessionId);
  });

  it("refuses to switch while Claude is still working", async () => {
    const { manager } = setup();
    const busy = manager.start("chat", "session", "long job");
    expect(() => manager.resume(busy.id, "", { stageId: "chat-chrome" })).toThrow(/still in progress|nothing to resume/);
  });
});
