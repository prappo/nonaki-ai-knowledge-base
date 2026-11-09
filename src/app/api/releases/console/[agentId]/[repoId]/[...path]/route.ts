import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { audit, currentActor } from "@/lib/audit";
import { agentView } from "@/lib/releases";
import { tunnel } from "@/lib/releaseTunnel";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Ctx = { params: Promise<{ agentId: string; repoId: string; path: string[] }> };

const MAX_BODY = 1024 * 1024;
/** Response headers passed through from the console (the rest are dropped). */
const PASS = ["content-type", "content-disposition", "content-security-policy", "cache-control", "x-content-type-options"];

/**
 * The embedded Release Console's API, tunnelled to an agent's own console on
 * its machine. Login-protected like every app route; the console there still
 * applies its own checks (blocked stages, typed versions, approvals).
 */
async function relay(req: NextRequest, { params }: Ctx): Promise<Response> {
  const { agentId, repoId, path } = await params;
  if (path[0] !== "api") return Response.json({ error: "Not found." }, { status: 404 });

  const agent = await prisma.releaseAgent.findUnique({ where: { id: agentId } });
  if (!agent) return Response.json({ error: "Unknown agent." }, { status: 404 });
  const view = agentView(agent);
  if (!view.repos.some((r) => r.id === repoId)) return Response.json({ error: "That agent doesn't serve this repo." }, { status: 404 });
  if (view.outdated) {
    return Response.json(
      { error: `${agent.name} runs release-agent ${agent.version ?? "?"}, which can't run the console. Update it to ${view.minVersion} or newer (see the Releases page).` },
      { status: 426 }
    );
  }
  if (!view.online) {
    return Response.json({ error: `${agent.name} is offline. Start it on that machine: release-agent start` }, { status: 503 });
  }

  const method = req.method === "POST" ? "POST" : "GET";
  let body: Buffer | null = null;
  if (method === "POST") {
    body = Buffer.from(await req.arrayBuffer());
    if (body.length > MAX_BODY) return Response.json({ error: "The request body is too large." }, { status: 413 });
  }
  const consolePath = "/" + path.map(encodeURIComponent).join("/");

  // record actions that change something, with who did them
  if (method === "POST") await auditAction(agent.name, agentId, repoId, consolePath, body);

  return new Promise<Response>((resolve) => {
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
    let answered = false;
    const stream = new ReadableStream<Uint8Array>({
      start: (c) => {
        controller = c;
      },
      cancel: () => tunnel.cancel(id),
    });
    const timer = setTimeout(() => {
      if (answered) return;
      answered = true;
      tunnel.cancel(id);
      resolve(Response.json({ error: `${agent.name} didn't answer in time.` }, { status: 504 }));
    }, 30_000);

    const id = tunnel.send(
      agentId,
      {
        repoId,
        method,
        path: consolePath,
        query: req.nextUrl.search.replace(/^\?/, ""),
        contentType: req.headers.get("content-type"),
        body: body ? body.toString("base64") : null,
      },
      {
        onHead: ({ status, headers }) => {
          if (answered) return;
          answered = true;
          clearTimeout(timer);
          const out = new Headers();
          for (const [k, v] of Object.entries(headers)) if (PASS.includes(k.toLowerCase())) out.set(k, v);
          if (out.get("content-type")?.startsWith("text/event-stream")) out.set("X-Accel-Buffering", "no");
          resolve(new Response(stream, { status, headers: out }));
        },
        onChunk: (data) => controller?.enqueue(data),
        onEnd: () => controller?.close(),
        onError: (message) => {
          if (!answered) {
            answered = true;
            clearTimeout(timer);
            resolve(Response.json({ error: message }, { status: 502 }));
          } else controller?.error(new Error(message));
        },
      }
    );
    req.signal.addEventListener("abort", () => tunnel.cancel(id));
  });
}

async function auditAction(agentName: string, agentId: string, repoId: string, path: string, body: Buffer | null) {
  let data: Record<string, unknown> = {};
  try {
    data = body && body.length ? (JSON.parse(body.toString("utf8")) as Record<string, unknown>) : {};
  } catch {
    /* the console rejects it anyway */
  }
  const where = `on ${agentName} (${repoId})`;
  const entry = (() => {
    if (path === "/api/runs") return [`release.run_started`, `Started ${String(data.stageId)} ${String(data.version)} ${where}`];
    if (path === "/api/chat") {
      const prompt = String(data.prompt ?? "").trim().split("\n")[0].slice(0, 120);
      return ["agent.session_started", `Agent session ${where}: ${prompt}`];
    }
    if (/^\/api\/chat\/[^/]+\/resume$/.test(path)) return ["agent.session_resumed", `Resumed an Agent session ${where}`];
    if (/^\/api\/chat\/[^/]+\/gates\//.test(path) && data.type === "approval") {
      return [data.allow ? "agent.approved" : "agent.denied", `${data.allow ? "Approved" : "Denied"} an action in an Agent session ${where}`];
    }
    if (/^\/api\/chat\/[^/]+\/stop$/.test(path)) return ["agent.session_stopped", `Stopped an Agent session ${where}`];
    if (path === "/api/chat/delete-all") return ["agent.sessions_deleted", `Deleted all Agent sessions ${where}`];
    if (/^\/api\/chat\/[^/]+\/delete$/.test(path)) return ["agent.session_deleted", `Deleted an Agent session ${where}`];
    if (/^\/api\/runs\/[^/]+\/resume$/.test(path)) return ["release.run_resumed", `Resumed a run ${where}`];
    if (/^\/api\/runs\/[^/]+\/gates\//.test(path) && data.type === "approval") {
      return [data.allow ? "release.approved" : "release.denied", `${data.allow ? "Approved" : "Denied"} a risky action ${where}`];
    }
    if (/^\/api\/runs\/[^/]+\/stop$/.test(path)) return ["release.run_stopped", `Stopped a run ${where}`];
    if (path === "/api/sequence") return ["release.sequence_started", `Run all from ${String(data.fromStageId)} ${String(data.version)} ${where}`];
    if (path === "/api/file") return ["release.file_saved", `Edited ${String(data.path)} ${where}`];
    if (path === "/api/config") return ["release.settings_saved", `Saved release settings ${where}`];
    if (path === "/api/builds") return ["release.build_started", `Started a local build ${where}`];
    if (path === "/api/ci-builds") return ["release.ci_build_started", `Started a ${data.beta === true ? "beta " : ""}CI build of ${String(data.branch)} ${where}`];
    if (path === "/api/reset/discard") return ["release.changes_discarded", `Discarded ${Array.isArray(data.paths) ? data.paths.length : 0} change(s) ${where}`];
    if (path === "/api/reset/restore") return ["release.backup_restored", `Restored a discard backup ${where}`];
    if (path === "/api/reset/console-data") return ["release.data_deleted", `Deleted release console data ${where}`];
    return null;
  })();
  if (!entry) return;
  await audit(entry[0], entry[1], {
    entityType: "releaseAgent",
    entityId: agentId,
    actor: await currentActor(),
    detail: {
      repoId,
      path,
      ...(data.stageId ? { stageId: data.stageId } : {}),
      ...(data.version ? { version: data.version } : {}),
      ...(path === "/api/chat" ? { prompt: String(data.prompt ?? "").slice(0, 2000), permissions: data.permissions, chrome: data.chrome === true } : {}),
    },
  });
}

export const GET = relay;
export const POST = relay;
