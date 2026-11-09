/** Deleting Agent chats: a chat is a session plus the sessions that resumed it. */

import { describe, expect, it } from "vitest";
import { RunManager } from "../src/runs/runner.ts";
import { MemoryRunStore } from "../src/runs/store.ts";
import type { RunSnapshot } from "../src/runs/runner.ts";

let n = 0;
function saved(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  n++;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    stageId: "chat",
    version: "session",
    prompt: `prompt ${n}`,
    status: "done",
    error: null,
    startedAt: n * 1000,
    endedAt: n * 1000 + 1,
    sessionId: `s${n}`,
    costUsd: 0.01,
    files: [],
    items: [],
    gates: [],
    resumedFrom: null,
    outcome: null,
    ...overrides,
  } as RunSnapshot;
}

function setup() {
  const store = new MemoryRunStore();
  const first = saved();
  const second = saved({ resumedFrom: first.id });
  const third = saved({ resumedFrom: second.id });
  const other = saved();
  for (const run of [first, second, third, other]) store.save(run);
  const neverCalled = () => {
    throw new Error("no sessions in these tests");
  };
  const manager = new RunManager("/repo", neverCalled as never, {}, store);
  return { store, manager, first, second, third, other };
}

describe("deleteConversation", () => {
  it("deletes the whole chain from any run in it, and nothing else", () => {
    const { store, manager, first, second, third, other } = setup();

    const deleted = manager.deleteConversation(second.id);

    expect(deleted.sort()).toEqual([first.id, second.id, third.id].sort());
    expect(manager.list().map((r) => r.id)).toEqual([other.id]);
    expect([...store.saved.keys()]).toEqual([other.id]);
  });

  it("refuses an unknown id", () => {
    const { manager } = setup();
    expect(() => manager.deleteConversation("00000000-0000-4000-8000-999999999999")).toThrow(/No such run/);
  });
});

describe("deleteAll", () => {
  it("forgets every run, in memory and in the store", () => {
    const { store, manager } = setup();

    expect(manager.deleteAll()).toBe(4);
    expect(manager.list()).toEqual([]);
    expect(store.saved.size).toBe(0);
  });
});
