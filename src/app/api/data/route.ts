import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { audit, currentActor } from "@/lib/audit";
import { resetChunkCollection } from "@/lib/weaviate";

export const maxDuration = 120;

/**
 * Data management for the Settings page.
 *  GET  → row counts for every purgeable category
 *  POST → { target } permanently deletes that category's data
 */

const TARGETS = [
  "documents",
  "sources",
  "proposals",
  "versions",
  "digest",
  "askHistory",
  "imports",
  "aiUsage",
  "audit",
  "projects",
  "everything",
] as const;
type Target = (typeof TARGETS)[number];

function isTarget(v: unknown): v is Target {
  return typeof v === "string" && (TARGETS as readonly string[]).includes(v);
}

const ACTIVE_JOB = { status: { in: ["running", "paused"] } };

async function counts() {
  const [
    documents,
    sources,
    proposals,
    pendingProposals,
    versions,
    digest,
    askHistory,
    imports,
    aiUsage,
    auditLog,
    projects,
    projectTasks,
  ] = await Promise.all([
    prisma.document.count(),
    prisma.source.count(),
    prisma.proposal.count(),
    prisma.proposal.count({ where: { status: "pending" } }),
    prisma.documentVersion.count(),
    prisma.syncLog.count(),
    prisma.askLog.count(),
    prisma.importJob.count({ where: { NOT: ACTIVE_JOB } }),
    prisma.aiUsage.count(),
    prisma.auditLog.count(),
    prisma.project.count(),
    prisma.projectTask.count(),
  ]);
  return {
    documents,
    sources,
    proposals,
    pendingProposals,
    versions,
    digest,
    askHistory,
    imports,
    aiUsage,
    audit: auditLog,
    projects,
    projectTasks,
  };
}

export async function GET() {
  return Response.json({ counts: await counts() });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { target?: unknown };
  if (!isTarget(body.target)) {
    return Response.json({ error: "Unknown data target" }, { status: 400 });
  }
  const target = body.target;
  const actor = await currentActor();

  // Wiping documents/sources mid-import would leave the runner writing into
  // rows that no longer exist — make the user stop it first.
  if (target === "documents" || target === "sources" || target === "everything") {
    const active = await prisma.importJob.count({ where: ACTIVE_JOB });
    if (active > 0) {
      return Response.json(
        { error: "An import is running or paused — cancel it on the Imports page first." },
        { status: 409 }
      );
    }
  }

  let deleted = 0;
  try {
    switch (target) {
      case "documents": {
        // Chunks first: if Weaviate is unreachable nothing is lost from Postgres.
        await resetChunkCollection();
        // Versions + proposals cascade with their documents.
        deleted = (await prisma.document.deleteMany()).count;
        break;
      }
      case "sources": {
        await resetChunkCollection();
        // Documents, versions, proposals and import jobs cascade; sync logs are detached.
        deleted = (await prisma.source.deleteMany()).count;
        break;
      }
      case "proposals":
        deleted = (await prisma.proposal.deleteMany()).count;
        break;
      case "versions":
        deleted = (await prisma.documentVersion.deleteMany()).count;
        break;
      case "digest":
        deleted = (await prisma.syncLog.deleteMany()).count;
        break;
      case "askHistory":
        deleted = (await prisma.askLog.deleteMany()).count;
        break;
      case "imports":
        deleted = (await prisma.importJob.deleteMany({ where: { NOT: ACTIVE_JOB } })).count;
        break;
      case "aiUsage":
        deleted = (await prisma.aiUsage.deleteMany()).count;
        break;
      case "audit":
        deleted = (await prisma.auditLog.deleteMany()).count;
        break;
      case "projects":
        // tasks and document links cascade; the documents themselves are kept
        deleted = (await prisma.project.deleteMany()).count;
        break;
      case "everything": {
        await resetChunkCollection();
        const results = await prisma.$transaction([
          prisma.project.deleteMany(), // cascades tasks + document links
          prisma.source.deleteMany(), // cascades documents, versions, proposals, import jobs
          prisma.syncLog.deleteMany(),
          prisma.askLog.deleteMany(),
          prisma.aiUsage.deleteMany(),
          prisma.auditLog.deleteMany(),
        ]);
        deleted = results.reduce((sum, r) => sum + r.count, 0);
        break;
      }
    }
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Delete failed" },
      { status: 500 }
    );
  }

  // Written after the purge so clearing the audit log still leaves a record of who did it.
  await audit("data.deleted", `Deleted ${target} data (${deleted} record${deleted === 1 ? "" : "s"})`, {
    entityType: "setting",
    actor,
    detail: { target, deleted },
  });

  return Response.json({ ok: true, deleted, counts: await counts() });
}
