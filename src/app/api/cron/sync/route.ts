import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { listItems, startImportJob, runImportJob, markJobFailed } from "@/lib/importer";
import { nextSyncAt } from "@/lib/schedule";
import { log } from "@/lib/indexer";

export const maxDuration = 300;

// A running job that hasn't heartbeated (updatedAt) for this long is
// considered stalled — its serverless function died mid-run.
const STALL_MS = 3 * 60 * 1000;

/**
 * Scheduler tick — invoked by Vercel Cron (see vercel.json) or manually.
 *  1. Resumes stalled jobs whose serverless function died mid-run (durability
 *     for the DB-backed job queue).
 *  2. Starts scheduled syncs for sources whose nextSyncAt is due.
 *
 * Auth: requires `Authorization: Bearer ${CRON_SECRET}` when CRON_SECRET is
 * set (Vercel sends this automatically for cron invocations).
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const resumed: string[] = [];
  const started: string[] = [];
  const errors: string[] = [];

  // 1. Pick stalled jobs back up. runImportJob continues from job.cursor and
  //    is a no-op if another runner already finished it.
  const stalled = await prisma.importJob.findMany({
    where: { status: "running", updatedAt: { lt: new Date(now.getTime() - STALL_MS) } },
    select: { id: true, sourceId: true, source: { select: { name: true } } },
    take: 5,
  });
  for (const job of stalled) {
    try {
      await log(`Resuming stalled ${job.source.name} job from its last checkpoint`, {
        sourceId: job.sourceId,
        level: "warn",
      });
      await runImportJob(job.id);
      resumed.push(job.id);
    } catch (err) {
      await markJobFailed(job.id, job.sourceId, err);
      errors.push(`resume ${job.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 2. Kick off due scheduled syncs.
  const due = await prisma.source.findMany({
    where: {
      enabled: true,
      syncInterval: { not: "manual" },
      nextSyncAt: { lte: now },
      status: { not: "syncing" },
      type: { in: ["wordpress", "github"] },
    },
    take: 10,
  });
  for (const source of due) {
    // Push nextSyncAt forward first so a crashing sync can't hot-loop the cron
    await prisma.source.update({
      where: { id: source.id },
      data: { nextSyncAt: nextSyncAt(source.syncInterval) },
    });
    try {
      const config = JSON.parse(source.config ?? "{}") as Record<string, string>;
      const items = await listItems(source.type, config);
      const job = await startImportJob(source.id, items, "sync", {
        trigger: "schedule",
        actor: "scheduler",
      });
      // We're already in the background — run to completion right here rather
      // than relying on after().
      await runImportJob(job.id).catch((err) => markJobFailed(job.id, source.id, err));
      started.push(job.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.source.update({
        where: { id: source.id },
        data: { status: "error", lastSyncError: message },
      });
      await log(`Scheduled sync of ${source.name} failed to start — ${message}`, {
        sourceId: source.id,
        level: "error",
      });
      errors.push(`${source.name}: ${message}`);
    }
  }

  return Response.json({ ok: true, resumed, started, errors });
}
