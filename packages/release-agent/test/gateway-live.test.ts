/**
 * Live status for the web app: one event stream per machine, sending a
 * project only when its status changes.
 */

import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { LiveHub, parseStatus } from "../src/gateway/live.ts";
import type { GatewayProject } from "../src/gateway/server.ts";

describe("parseStatus", () => {
  it("reads the branch, tracking and changed files", () => {
    expect(parseStatus("## release/4.17.7...origin/release/4.17.7 [ahead 2, behind 1]\n M a.php\n?? b.md\n")).toEqual({ branch: "release/4.17.7", changes: 2, ahead: 2, behind: 1 });
    expect(parseStatus("## develop\n")).toEqual({ branch: "develop", changes: 0, ahead: 0, behind: 0 });
    expect(parseStatus("## HEAD (no branch)\n M x\n")).toMatchObject({ branch: null, changes: 1 });
    expect(parseStatus("## No commits yet on main\n")).toMatchObject({ branch: "main" });
  });
});

type Ev = { event: string; data: { id?: string; projects?: { id: string }[]; changes?: number; run?: unknown; ci?: unknown } };

let servers: http.Server[] = [];
afterEach(() => {
  for (const s of servers) s.close();
  servers = [];
});

function setup(overrides: Partial<ConstructorParameters<typeof LiveHub>[0]> = {}) {
  const state = {
    projects: [{ id: "wpsp", name: "WPSP", path: "/repo/wpsp", recipe: "wpsp-pro", port: 1111 }] as GatewayProject[],
    status: "## release/4.17.7\n",
    live: { run: null as unknown, chat: null as unknown },
    ciCalls: 0,
    gitCalls: 0,
  };
  const hub = new LiveHub({
    projects: () => state.projects,
    git: async () => {
      state.gitCalls++;
      return state.status;
    },
    readConsole: async (_port, p) => {
      if (p === "/api/ci-builds") {
        state.ciCalls++;
        return { runs: [{ status: "in_progress", conclusion: null, branch: "release/4.17.7", url: "https://github.com/x/actions/runs/1", createdAt: "2026-11-11T00:00:00Z" }] };
      }
      return state.live;
    },
    interval: 30,
    ciInterval: 60_000,
    ciActiveInterval: 60_000,
    keepAlive: 60_000,
    watchGit: false,
    ...overrides,
  });
  const server = http.createServer((req, res) => hub.subscribe(req, res));
  servers.push(server);
  return { hub, state, server };
}

/** Collect events from the stream until `until` says stop (or a timeout). */
async function listen(server: http.Server, until: (events: Ev[]) => boolean, ms = 2000): Promise<Ev[]> {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as { port: number };
  const ctl = new AbortController();
  const events: Ev[] = [];
  const res = await fetch(`http://127.0.0.1:${port}/`, { signal: ctl.signal });
  const reader = res.body!.getReader();
  const timeout = setTimeout(() => ctl.abort(), ms);
  let buffer = "";
  try {
    while (!until(events)) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += new TextDecoder().decode(value);
      let end: number;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const event = block.match(/^event: (.*)$/m)?.[1];
        const data = block.match(/^data: (.*)$/m)?.[1];
        if (event && data) events.push({ event, data: JSON.parse(data) });
      }
    }
  } catch {
    /* aborted */
  } finally {
    clearTimeout(timeout);
    ctl.abort();
  }
  return events;
}

describe("LiveHub", () => {
  it("sends a snapshot, then each project once, then only what changes", async () => {
    const { state, server } = setup();
    setTimeout(() => (state.status = "## release/4.17.7\n M a.php\n"), 120);
    setTimeout(() => (state.live = { run: { id: "r1", stageId: "prep", title: "Bump version", status: "waiting", active: true, needsYou: true }, chat: null }), 240);
    const events = await listen(server, (e) => e.filter((x) => x.event === "project").length >= 3);

    expect(events[0]).toEqual({ event: "snapshot", data: { projects: [] } });
    const projects = events.filter((e) => e.event === "project").map((e) => e.data);
    expect(projects[0]).toMatchObject({ id: "wpsp", branch: "release/4.17.7", changes: 0, ready: true, ci: { status: "in_progress" } });
    expect(projects[1]).toMatchObject({ changes: 1, run: null });
    expect(projects[2]).toMatchObject({ changes: 1, run: { title: "Bump version", needsYou: true } });
    // ticks kept running in between, but sent nothing unchanged
    expect(state.gitCalls).toBeGreaterThan(projects.length);
    // GitHub isn't asked on every tick
    expect(state.ciCalls).toBe(1);
  });

  it("says when a project goes away", async () => {
    const { state, server } = setup();
    setTimeout(() => (state.projects = []), 120);
    const events = await listen(server, (e) => e.some((x) => x.event === "removed"));
    expect(events.at(-1)).toEqual({ event: "removed", data: { id: "wpsp" } });
  });

  it("does nothing while nobody watches", async () => {
    const { hub, state, server } = setup();
    await listen(server, (e) => e.some((x) => x.event === "project"));
    await new Promise((r) => setTimeout(r, 100));
    const calls = state.gitCalls;
    await new Promise((r) => setTimeout(r, 150));
    expect(hub.watching).toBe(0);
    expect(state.gitCalls).toBe(calls);
  });

  it("shows a project whose console is restarting as not ready, without failing", async () => {
    const { state, server } = setup({ readConsole: async () => Promise.reject(new Error("down")) });
    state.projects = [{ ...state.projects[0], port: null }];
    const events = await listen(server, (e) => e.some((x) => x.event === "project"));
    expect(events.find((e) => e.event === "project")!.data).toMatchObject({ ready: false, run: null, ci: null });
  });
});
