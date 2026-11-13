/**
 * The gateway for the Release Console web app: its tokens, and what it lets
 * through to a project's console.
 */

import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_TOKEN_SECONDS, verifyToken } from "../src/gateway/token.ts";
import { startGateway, type GatewayProject } from "../src/gateway/server.ts";

const APP = "https://release.example.com";
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const other = generateKeyPairSync("ed25519");
const NOW = 1_800_000_000;

function token(claims: Record<string, unknown> = {}, key: KeyObject = privateKey, header: Record<string, unknown> = { alg: "EdDSA", typ: "JWT" }) {
  const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const body = { iss: APP, aud: "machine:m1", sub: "u1", iat: NOW, exp: NOW + 300, email: "p@awesomemotive.com", ...claims };
  const signing = `${enc(header)}.${enc(body)}`;
  return `${signing}.${sign(null, Buffer.from(signing), key).toString("base64url")}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (res: Response): Promise<any> => res.json();

const expectFor = { issuer: APP, machineId: "m1", ownerId: "u1", publicKey, now: NOW };

describe("verifyToken", () => {
  it("accepts the app's token for this machine and its owner", () => {
    expect(verifyToken(token(), expectFor)).toMatchObject({ sub: "u1", aud: "machine:m1", email: "p@awesomemotive.com" });
  });

  it("refuses everything else", () => {
    const cases: [string, string][] = [
      [token({ aud: "machine:m2" }), "another machine"],
      [token({ sub: "u2" }), "another user"],
      [token({ iss: "https://evil.example.com" }), "another app"],
      [token({ exp: NOW - 31 }), "expired"],
      [token({ iat: NOW + 120, exp: NOW + 300 }), "future"],
      [token({ exp: NOW + MAX_TOKEN_SECONDS + 1 }), "too long"],
      [token({}, other.privateKey), "signature"],
      [token({}, privateKey, { alg: "none" }), "algorithm"],
      [token({}, privateKey, { alg: "HS256" }), "algorithm"],
      [`${token().split(".").slice(0, 2).join(".")}.`, "Malformed"],
      ["not-a-token", "Malformed"],
    ];
    for (const [t, why] of cases) expect(() => verifyToken(t, expectFor), why).toThrow(new RegExp(why, "i"));
  });

  it("refuses a tampered payload", () => {
    const [h, , s] = token().split(".");
    const forged = Buffer.from(JSON.stringify({ iss: APP, aud: "machine:m1", sub: "u1", iat: NOW, exp: NOW + 300, admin: true })).toString("base64url");
    expect(() => verifyToken(`${h}.${forged}.${s}`, expectFor)).toThrow(/signature/i);
  });
});

describe("gateway", () => {
  let consoleServer: http.Server;
  let gateway: http.Server;
  let base = "";
  let gatewayPort = 0;
  const seen: { url: string; host: string; method: string; body: string }[] = [];
  const projects: GatewayProject[] = [];
  let revoked = false;

  beforeAll(async () => {
    // A stand-in for a project's console: echoes, and streams events.
    consoleServer = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        seen.push({ url: req.url ?? "", host: String(req.headers.host), method: req.method ?? "", body });
        if (req.url?.startsWith("/api/runs/r1/events")) {
          res.writeHead(200, { "content-type": "text/event-stream" });
          res.write("data: one\n\n");
          setTimeout(() => res.end("data: two\n\n"), 20);
          return;
        }
        if (req.url?.startsWith("/api/raw/")) {
          res.writeHead(200, { "content-type": "text/html", "content-security-policy": "sandbox; script-src 'none'", "x-content-type-options": "nosniff" });
          res.end("<script>alert(1)</script>");
          return;
        }
        res.writeHead(200, { "content-type": "application/json", "set-cookie": "leak=1" });
        res.end(JSON.stringify({ ok: true, url: req.url }));
      });
    });
    await new Promise<void>((r) => consoleServer.listen(0, "127.0.0.1", r));
    const consolePort = (consoleServer.address() as { port: number }).port;
    projects.push(
      { id: "wpsp", name: "WP Simple Pay Pro", path: "/repo/wpsp", recipe: "wpsp-pro", port: consolePort },
      { id: "starting", name: "Starting", path: "/repo/s", recipe: "x", port: null }
    );

    gateway = await startGateway(
      {
        appOrigin: APP,
        machineId: "m1",
        ownerId: "u1",
        publicKey,
        tunnelHosts: ["agent.example.com"],
        projects: () => projects,
        version: "test",
        revoked: () => revoked,
        now: () => NOW,
        manage: {
          discover: async () => ({ repos: [{ path: "/repo/a" }] }),
          recipes: async () => [{ name: "wpsp-pro" }],
          check: async (body) => {
            if (body.path === "/outside") throw Object.assign(new Error("not allowed"), { status: 403 });
            return { ok: true, path: body.path };
          },
          add: async (body, who) => ({ project: { id: "new", path: body.path, by: who } }),
          remove: async (id) => id === "wpsp",
          setRecipe: async (id, body) => {
            if (id !== "wpsp") throw Object.assign(new Error("This machine doesn't serve that project."), { status: 404 });
            return { project: { id, recipe: body.recipe } };
          },
        },
      },
      0
    );
    gatewayPort = (gateway.address() as { port: number }).port;
    base = `http://127.0.0.1:${gatewayPort}`;
  });

  afterAll(() => {
    gateway.close();
    consoleServer.close();
  });

  const auth = (t = token()) => ({ authorization: `Bearer ${t}` });

  it("answers /health without a token, and nothing else", async () => {
    expect(await json(await fetch(`${base}/health`))).toEqual({ ok: true, gateway: "release-agent", version: "test", machineId: "m1" });
    const res = await fetch(`${base}/projects`);
    expect(res.status).toBe(401);
    expect((await json(res)).error).toMatch(/no token/);
  });

  it("lists the projects with a token", async () => {
    const data = await json(await fetch(`${base}/projects`, { headers: auth() }));
    expect(data.projects).toEqual([
      { id: "wpsp", name: "WP Simple Pay Pro", path: "/repo/wpsp", recipe: "wpsp-pro", ready: true },
      { id: "starting", name: "Starting", path: "/repo/s", recipe: "x", ready: false },
    ]);
  });

  it("refuses a token for another machine or user", async () => {
    expect((await fetch(`${base}/projects`, { headers: auth(token({ aud: "machine:m2" })) })).status).toBe(401);
    expect((await fetch(`${base}/projects`, { headers: auth(token({ sub: "u2" })) })).status).toBe(401);
  });

  const urlToken = (claims: Record<string, unknown> = {}) => token({ scope: "read", exp: NOW + 30 * 60, ...claims });

  it("keeps read-only URL tokens to GET, and full tokens out of URLs", async () => {
    expect((await fetch(`${base}/t/${urlToken()}/projects`)).status).toBe(200);
    expect((await fetch(`${base}/projects?access_token=${urlToken()}`)).status).toBe(200);
    // a read token can't do anything
    expect((await fetch(`${base}/t/${urlToken()}/projects/wpsp/api/runs`, { method: "POST" })).status).toBe(401);
    expect((await fetch(`${base}/projects/wpsp/api/runs?access_token=${urlToken()}`, { method: "POST" })).status).toBe(401);
    // …and isn't accepted as a header
    expect((await fetch(`${base}/projects`, { headers: auth(urlToken()) })).status).toBe(401);
    // a full token doesn't belong in a URL
    expect((await fetch(`${base}/t/${token()}/projects`)).status).toBe(401);
    expect((await fetch(`${base}/projects?access_token=${token()}`)).status).toBe(401);
    // read tokens still have a ceiling
    expect((await fetch(`${base}/t/${urlToken({ exp: NOW + 60 * 60 })}/projects`)).status).toBe(401);
  });

  it("keeps the path token for relative links inside a served file", async () => {
    const res = await fetch(`${base}/t/${urlToken()}/projects/wpsp/api/raw/docs/releases/4.17.7/newsletter.html`);
    expect(res.status).toBe(200);
    // The console's sandbox survives the trip, so a served HTML file can't run scripts on the tunnel's address…
    expect(res.headers.get("content-security-policy")).toBe("sandbox; script-src 'none'");
    // …and the token in the path never leaks in a Referer.
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(seen.at(-1)!.url).toBe("/api/raw/docs/releases/4.17.7/newsletter.html");
  });

  it("passes console calls through, with the console's own Host and without the token", async () => {
    const res = await fetch(`${base}/projects/wpsp/api/state?version=4.17.7&access_token=${urlToken()}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();
    const last = seen.at(-1)!;
    expect(last.url).toBe("/api/state?version=4.17.7");
    expect(last.host).toMatch(/^127\.0\.0\.1:\d+$/);

    await fetch(`${base}/projects/wpsp/api/runs`, { method: "POST", headers: { ...auth(), "content-type": "application/json" }, body: JSON.stringify({ stage: "prep" }) });
    expect(seen.at(-1)).toMatchObject({ method: "POST", url: "/api/runs", body: '{"stage":"prep"}' });
  });

  it("streams event streams as they come", async () => {
    const res = await fetch(`${base}/t/${urlToken()}/projects/wpsp/api/runs/r1/events`);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(res.headers.get("x-accel-buffering")).toBe("no");
    expect(await res.text()).toBe("data: one\n\ndata: two\n\n");
  });

  it("lets the owner find, check, add and remove projects", async () => {
    const post = (p: string, body?: unknown) => fetch(`${base}${p}`, { method: "POST", headers: { ...auth(), "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    expect(await json(await fetch(`${base}/discover`, { headers: auth() }))).toEqual({ repos: [{ path: "/repo/a" }] });
    expect(await json(await fetch(`${base}/recipes`, { headers: auth() }))).toEqual({ recipes: [{ name: "wpsp-pro" }] });
    expect(await json(await post("/check", { path: "/repo/a" }))).toEqual({ ok: true, path: "/repo/a" });
    const refused = await post("/check", { path: "/outside" });
    expect(refused.status).toBe(403);
    expect((await json(refused)).error).toBe("not allowed");
    const added = await post("/projects", { path: "/repo/a" });
    expect(added.status).toBe(201);
    expect((await json(added)).project.by).toBe("p@awesomemotive.com");
    expect(await json(await post("/projects/wpsp/recipe", { recipe: "repo" }))).toEqual({ project: { id: "wpsp", recipe: "repo" } });
    expect((await post("/projects/nope/recipe", { recipe: "repo" })).status).toBe(404);
    expect((await post("/projects/wpsp/remove")).status).toBe(200);
    expect((await post("/projects/nope/remove")).status).toBe(404);
    expect((await fetch(`${base}/check`, { method: "POST", headers: auth(), body: "not json" })).status).toBe(400);
    expect((await fetch(`${base}/discover`)).status).toBe(401);
  });

  it("only proxies a project's console API", async () => {
    expect((await fetch(`${base}/projects/nope/api/state`, { headers: auth() })).status).toBe(404);
    expect((await fetch(`${base}/projects/starting/api/state`, { headers: auth() })).status).toBe(503);
    expect((await fetch(`${base}/projects/wpsp/index.html`, { headers: auth() })).status).toBe(404);
    expect((await fetch(`${base}/projects/wpsp/api/x`, { method: "DELETE", headers: auth() })).status).toBe(405);
  });

  it("gives CORS to the app's origin only", async () => {
    const pre = await fetch(`${base}/projects`, { method: "OPTIONS", headers: { origin: APP } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe(APP);
    expect(pre.headers.get("access-control-allow-headers")).toMatch(/Authorization/);

    const evil = await fetch(`${base}/projects`, { headers: { origin: "https://evil.example.com", ...auth() } });
    expect(evil.status).toBe(403);
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("accepts loopback and the tunnel's hostname as Host, nothing else", async () => {
    const hostCall = (host: string) =>
      new Promise<number>((resolve) => {
        http.get({ host: "127.0.0.1", port: gatewayPort, path: "/health", headers: { host } }, (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        });
      });
    expect(await hostCall("agent.example.com")).toBe(200);
    expect(await hostCall(`localhost:${gatewayPort}`)).toBe(200);
    expect(await hostCall("attacker.example.net")).toBe(403);
  });

  it("refuses every token once the machine is revoked", async () => {
    revoked = true;
    const res = await fetch(`${base}/projects`, { headers: auth() });
    revoked = false;
    expect(res.status).toBe(401);
    expect((await json(res)).error).toMatch(/revoked/);
  });

  it("slows down a client that keeps sending bad tokens", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 32; i++) statuses.push((await fetch(`${base}/projects`, { headers: { ...auth("x.y.z"), "cf-connecting-ip": "203.0.113.9" } })).status);
    expect(statuses.slice(0, 30).every((s) => s === 401)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
    // …without locking out anyone else.
    expect((await fetch(`${base}/projects`, { headers: auth() })).status).toBe(200);
  });
});
