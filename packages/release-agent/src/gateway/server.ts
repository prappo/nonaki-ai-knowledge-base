/**
 * The gateway: one local port in front of every project's Release Console,
 * for the Release Console web app. A Cloudflare Tunnel publishes it at an
 * https:// address; the browser calls it directly, so run output and agent
 * sessions stream live without passing through the web app's servers.
 *
 *   GET  /health                        no token: is this a gateway, which machine
 *   GET  /projects                      the projects this machine serves
 *   GET|POST /projects/<id>/api/...     that project's console API, streamed
 *   GET  /discover                      git repos inside the allowed folders
 *   GET  /recipes                       the recipes a project can use
 *   POST /check    { path, recipe }     would this folder and recipe work?
 *   POST /projects { path, recipe, name? }   serve a new project
 *   POST /projects/<id>/remove          stop serving it (the folder stays)
 *   POST /projects/<id>/recipe { recipe }   switch it to another recipe
 *   GET  /events                        live status of every project (an event stream)
 *
 * Every request but /health needs the web app's token (see token.ts): a full
 * token as `Authorization: Bearer …`, or a read-only one in the URL, for what
 * can't send headers (event streams, file views, downloads, images), as a
 * `/t/<token>/…` prefix (relative links inside an HTML file keep it) or
 * `?access_token=…`. URL tokens only work for GET. Only the
 * web app's origin gets CORS, and only the tunnel's hostname and loopback are
 * accepted as Host, which keeps DNS rebinding out. The consoles keep their
 * own checks behind this (risk approvals, typed confirmations).
 */

import http from "node:http";
import type { KeyObject } from "node:crypto";
import { TokenError, verifyToken, type TokenClaims } from "./token.ts";

export interface GatewayProject {
  id: string;
  name: string;
  path: string;
  recipe: string;
  /** The project's console on 127.0.0.1, or null while it (re)starts. */
  port: number | null;
}

/** Adding and removing projects (src/gateway/projects.ts does the checks). */
export interface ProjectManager {
  discover(): Promise<unknown>;
  recipes(): Promise<unknown>;
  check(body: Record<string, unknown>): Promise<unknown>;
  add(body: Record<string, unknown>, who: string): Promise<unknown>;
  remove(id: string, who: string): Promise<boolean>;
  setRecipe(id: string, body: Record<string, unknown>, who: string): Promise<unknown>;
}

export interface GatewayOptions {
  /** The web app's origin: the token issuer, and the only CORS origin. */
  appOrigin: string;
  machineId: string;
  ownerId: string;
  publicKey: KeyObject | string;
  /** Host header values accepted besides loopback, e.g. agent.example.com. */
  tunnelHosts: string[];
  /** The gateway's own port, for the loopback Host check (set once listening). */
  port: () => number;
  projects: () => GatewayProject[];
  version: string;
  /** Live status for GET /events; without it that route is 404. */
  live?: { subscribe(req: http.IncomingMessage, res: http.ServerResponse): void };
  /** Lets the web app add and remove projects; without it those routes are 404. */
  manage?: ProjectManager;
  /** Set when the web app says this machine was revoked: every token is refused. */
  revoked?: () => boolean;
  log?: (message: string) => void;
  /** Tests pass their own clock (seconds). */
  now?: () => number;
}

/** Failed token checks allowed per client per minute before it's told to slow down. */
const FAILURES_PER_MINUTE = 30;
const HOP_HEADERS = [
  "content-type",
  "content-length",
  "cache-control",
  "content-disposition",
  "last-modified",
  "etag",
  // The console's own protections, e.g. the CSP sandbox on repo files (no scripts in a served HTML file).
  "content-security-policy",
  "x-content-type-options",
  "x-frame-options",
];

class GatewayError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const MAX_BODY = 64 * 1024;

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new GatewayError(413, "Request too large.");
    chunks.push(chunk as Buffer);
  }
  if (!size) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    /* fall through */
  }
  throw new GatewayError(400, "Send a JSON object.");
}

/** Errors from the project checks carry their own HTTP status. */
const asGatewayError = (err: unknown) =>
  err instanceof GatewayError ? err : typeof (err as { status?: unknown }).status === "number" ? new GatewayError((err as { status: number }).status, (err as Error).message) : err;

export function createGatewayHandler(options: GatewayOptions) {
  const failures = new Map<string, { count: number; since: number }>();
  const log = options.log ?? (() => {});

  function cors(req: http.IncomingMessage, res: http.ServerResponse) {
    // Links carry a read-only token in the path: never send it on in a Referer.
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Vary", "Origin");
    if (req.headers.origin === options.appOrigin) {
      res.setHeader("Access-Control-Allow-Origin", options.appOrigin);
      res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
    }
  }

  function send(res: http.ServerResponse, status: number, body: unknown): void {
    if (res.headersSent) {
      res.end();
      return;
    }
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify(body));
  }

  function checkHost(req: http.IncomingMessage) {
    const host = String(req.headers.host ?? "").toLowerCase();
    const port = options.port();
    const loopback = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
    if (!loopback.includes(host) && !options.tunnelHosts.includes(host)) throw new GatewayError(403, "Unexpected Host header.");
  }

  /** Cloudflare passes the visitor's address on; loopback otherwise. */
  const clientOf = (req: http.IncomingMessage) => String(req.headers["cf-connecting-ip"] ?? req.socket.remoteAddress ?? "?");

  function authenticate(req: http.IncomingMessage, url: URL, pathToken: string | null): TokenClaims {
    const client = clientOf(req);
    const now = Date.now();
    const seen = failures.get(client);
    if (seen && now - seen.since < 60_000 && seen.count >= FAILURES_PER_MINUTE) throw new GatewayError(429, "Too many bad tokens. Wait a minute.");

    const header = String(req.headers.authorization ?? "");
    const fromHeader = header.startsWith("Bearer ") ? header.slice(7).trim() : null;
    const token = fromHeader ?? pathToken ?? url.searchParams.get("access_token");
    try {
      if (options.revoked?.()) throw new TokenError("This machine was revoked in the web app. Pair it again: release-agent link <app URL> --code <code>");
      if (!token) throw new TokenError("Sign in through the Release Console web app: this request has no token.");
      const claims = verifyToken(token, {
        issuer: options.appOrigin,
        machineId: options.machineId,
        ownerId: options.ownerId,
        publicKey: options.publicKey,
        now: options.now?.(),
      });
      if (fromHeader && claims.scope !== "full") throw new TokenError("A read-only token only works in a URL.");
      if (!fromHeader && claims.scope !== "read") throw new TokenError("Send this token in the Authorization header, not the URL.");
      if (!fromHeader && req.method !== "GET") throw new TokenError("A token in the URL is read-only.");
      return claims;
    } catch (err) {
      const entry = seen && now - seen.since < 60_000 ? seen : { count: 0, since: now };
      entry.count++;
      failures.set(client, entry);
      if (failures.size > 10_000) failures.clear();
      throw new GatewayError(401, err instanceof TokenError ? err.message : "Invalid token.");
    }
  }

  /** Stream the request to the project's console and its answer back, event streams included. */
  function proxy(req: http.IncomingMessage, res: http.ServerResponse, project: GatewayProject, path: string, url: URL) {
    if (!project.port) throw new GatewayError(503, `The console for ${project.name} is starting. Try again in a moment.`);
    const query = new URLSearchParams(url.searchParams);
    query.delete("access_token"); // the token stops here
    const qs = query.toString();

    const headers: http.OutgoingHttpHeaders = { host: `127.0.0.1:${project.port}` };
    for (const name of ["content-type", "content-length", "accept"]) if (req.headers[name]) headers[name] = req.headers[name];

    const upstream = http.request({ host: "127.0.0.1", port: project.port, method: req.method, path: `${path}${qs ? `?${qs}` : ""}`, headers }, (answer) => {
      const out: http.OutgoingHttpHeaders = {};
      for (const name of HOP_HEADERS) if (answer.headers[name]) out[name] = answer.headers[name];
      // Cloudflare and other proxies pass event streams through unbuffered when told to.
      if (String(answer.headers["content-type"] ?? "").startsWith("text/event-stream")) out["x-accel-buffering"] = "no";
      res.writeHead(answer.statusCode ?? 502, out);
      answer.pipe(res);
    });
    upstream.on("error", (err) => send(res, 502, { error: `The console for ${project.name} didn't answer: ${err.message}` }));
    // The browser went away (closed an event stream): stop the console request too.
    res.on("close", () => upstream.destroy());
    req.pipe(upstream);
  }

  return async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      checkHost(req);
      const origin = req.headers.origin;
      if (origin !== undefined && origin !== options.appOrigin) throw new GatewayError(403, "Unexpected Origin header.");
      cors(req, res);

      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Methods": "GET, POST",
          "Access-Control-Allow-Headers": "Authorization, Content-Type",
          "Access-Control-Max-Age": "600",
        });
        res.end();
        return;
      }
      if (req.method !== "GET" && req.method !== "POST") throw new GatewayError(405, "Method not allowed.");

      const url = new URL(req.url ?? "/", "http://gateway");
      let parts = url.pathname.split("/").filter(Boolean);
      // /t/<token>/projects/…: a read-only token in the path.
      let pathToken: string | null = null;
      if (parts[0] === "t" && parts[1]) {
        pathToken = decodeURIComponent(parts[1]);
        parts = parts.slice(2);
        url.pathname = `/${parts.join("/")}`;
      }

      if (url.pathname === "/health" && req.method === "GET") {
        send(res, 200, { ok: true, gateway: "release-agent", version: options.version, machineId: options.machineId });
        return;
      }

      const claims = authenticate(req, url, pathToken);

      if (parts.length === 1 && parts[0] === "projects" && req.method === "GET") {
        send(res, 200, {
          machineId: options.machineId,
          version: options.version,
          projects: options.projects().map(({ id, name, path, recipe, port }) => ({ id, name, path, recipe, ready: port !== null })),
        });
        return;
      }

      if (url.pathname === "/events" && req.method === "GET" && options.live) {
        options.live.subscribe(req, res);
        return;
      }

      const manage = options.manage;
      const who = claims.email ?? claims.sub;
      if (manage) {
        try {
          if (url.pathname === "/discover" && req.method === "GET") return send(res, 200, await manage.discover());
          if (url.pathname === "/recipes" && req.method === "GET") return send(res, 200, { recipes: await manage.recipes() });
          if (url.pathname === "/check" && req.method === "POST") return send(res, 200, await manage.check(await readJson(req)));
          if (url.pathname === "/projects" && req.method === "POST") return send(res, 201, await manage.add(await readJson(req), who));
          if (parts.length === 3 && parts[0] === "projects" && parts[2] === "recipe" && req.method === "POST") {
            return send(res, 200, await manage.setRecipe(decodeURIComponent(parts[1]), await readJson(req), who));
          }
          if (parts.length === 3 && parts[0] === "projects" && parts[2] === "remove" && req.method === "POST") {
            const removed = await manage.remove(decodeURIComponent(parts[1]), who);
            return send(res, removed ? 200 : 404, removed ? { ok: true } : { error: "This machine doesn't serve that project." });
          }
        } catch (err) {
          throw asGatewayError(err);
        }
      }

      if (parts[0] === "projects" && parts[1] && parts[2] === "api") {
        const project = options.projects().find((p) => p.id === decodeURIComponent(parts[1]));
        if (!project) throw new GatewayError(404, "This machine doesn't serve that project.");
        // Already percent-encoded, and dot segments were resolved by URL parsing.
        const rest = `/${parts.slice(2).join("/")}`;
        if (req.method === "POST") log(`${who}: ${req.method} ${project.name} ${rest}`);
        proxy(req, res, project, rest, url);
        return;
      }

      throw new GatewayError(404, "Not found.");
    } catch (err) {
      const status = err instanceof GatewayError ? err.status : 500;
      if (status === 500) log(`gateway error: ${(err as Error).message}`);
      send(res, status, { error: status === 500 ? "The gateway hit an error." : (err as Error).message });
    }
  };
}

/** Listen on loopback only: the tunnel is the one way in from outside. */
export function startGateway(options: Omit<GatewayOptions, "port">, port: number): Promise<http.Server> {
  let actual = port;
  const server = http.createServer(createGatewayHandler({ ...options, port: () => actual }));
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      actual = (server.address() as { port: number }).port;
      server.off("error", reject);
      resolve(server);
    });
  });
}
