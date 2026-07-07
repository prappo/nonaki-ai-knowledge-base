import { NextRequest } from "next/server";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { runImportJob, startImportJob, markJobFailed, type ImportItem } from "@/lib/importer";
import { log } from "@/lib/indexer";
import { currentActor } from "@/lib/audit";

export const maxDuration = 120;

/** Control an import: body { action: "pause" | "resume" | "cancel" | "retry" } */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { action } = (await req.json()) as { action?: string };

  const job = await prisma.importJob.findUnique({
    where: { id },
    include: { source: { select: { id: true, name: true } } },
  });
  if (!job) return Response.json({ error: "Job not found" }, { status: 404 });

  if (action === "pause") {
    if (job.status !== "running") {
      return Response.json({ error: `Job is ${job.status}` }, { status: 409 });
    }
    await prisma.importJob.update({ where: { id }, data: { status: "paused" } });
    return Response.json({ ok: true, status: "paused" });
  }

  if (action === "resume") {
    if (job.status !== "paused") {
      return Response.json({ error: `Job is ${job.status}` }, { status: 409 });
    }
    await prisma.importJob.update({ where: { id }, data: { status: "running" } });
    after(() => runImportJob(id).catch((err) => markJobFailed(id, job.source.id, err)));
    return Response.json({ ok: true, status: "running" });
  }

  if (action === "cancel") {
    if (!["running", "paused"].includes(job.status)) {
      return Response.json({ error: `Job is ${job.status}` }, { status: 409 });
    }
    const wasPaused = job.status === "paused";
    await prisma.importJob.update({ where: { id }, data: { status: "cancelled" } });
    if (wasPaused) {
      // No runner loop is alive to finalize — do it here
      await prisma.importJob.update({
        where: { id },
        data: { current: null, finishedAt: new Date() },
      });
      await prisma.source.update({
        where: { id: job.source.id },
        data: { status: "connected" },
      });
      await log(`Import cancelled — ${job.imported} imported before stopping`, {
        sourceId: job.source.id,
      });
    }
    return Response.json({ ok: true, status: "cancelled" });
  }

  if (action === "retry") {
    if (!["error", "cancelled", "completed"].includes(job.status)) {
      return Response.json(
        { error: `Only finished jobs can be retried (job is ${job.status})` },
        { status: 409 }
      );
    }
    const items = JSON.parse(job.items ?? "[]") as ImportItem[];
    if (items.length === 0) {
      return Response.json({ error: "This job has no items to retry" }, { status: 400 });
    }
    try {
      const actor = await currentActor();
      const retry = await startImportJob(job.source.id, items, job.kind as "import" | "sync", {
        trigger: "retry",
        retryOfId: job.id,
        actor,
      });
      return Response.json({ ok: true, job: { id: retry.id, total: retry.total } });
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : "Retry failed to start" },
        { status: 409 }
      );
    }
  }

  return Response.json({ error: "action must be pause, resume, cancel or retry" }, { status: 400 });
}
