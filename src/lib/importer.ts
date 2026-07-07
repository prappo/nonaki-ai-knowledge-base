import { after } from "next/server";
import { prisma } from "./prisma";
import { indexDocument, log } from "./indexer";
import { audit } from "./audit";
import { nextSyncAt } from "./schedule";
import { listWpItems, fetchWpItem, type WpConfig } from "./wordpress";
import { listGithubItems, fetchGithubItem, type GithubConfig } from "./github";

export type ImportItem = {
  externalId: string;
  title: string;
  kind: string;
  state?: string; // github: open | closed | merged
};

export type Selection =
  | { mode: "all" }
  | { mode: "count"; count: number }
  | { mode: "select"; selected: string[] };

/** DATA_SOURCE_DISABLED=true turns off importing new/updated content everywhere (manual, sync, upload, cron). */
export function isImportingDisabled(): boolean {
  return process.env.DATA_SOURCE_DISABLED === "true";
}

/** List importable items for a source type + config (used for preview & jobs). */
export async function listItems(
  type: string,
  config: Record<string, string>
): Promise<ImportItem[]> {
  if (type === "wordpress") return listWpItems(config as WpConfig);
  if (type === "github") return listGithubItems(config as unknown as GithubConfig);
  throw new Error(`Unsupported source type "${type}"`);
}

async function fetchItem(
  type: string,
  config: Record<string, string>,
  externalId: string
): Promise<{ title: string; content: string; url: string; kind: string }> {
  if (type === "wordpress") return fetchWpItem(config as WpConfig, externalId);
  if (type === "github")
    return fetchGithubItem(config as unknown as GithubConfig, externalId);
  throw new Error(`Unsupported source type "${type}"`);
}

export function applySelection(items: ImportItem[], selection: Selection): ImportItem[] {
  if (selection.mode === "count") {
    return items.slice(0, Math.max(1, selection.count));
  }
  if (selection.mode === "select") {
    const wanted = new Set(selection.selected);
    return items.filter((i) => wanted.has(i.externalId));
  }
  return items; // "all" (default)
}

/**
 * Create an import job and start processing it in the background.
 * Returns the job row immediately — the UI polls /api/import/active for progress.
 */
export async function startImportJob(
  sourceId: string,
  items: ImportItem[],
  kind: "import" | "sync" = "import",
  opts: { trigger?: "manual" | "schedule" | "retry"; retryOfId?: string; actor?: string } = {}
) {
  if (isImportingDisabled()) {
    throw new Error("Data source importing is disabled");
  }

  const active = await prisma.importJob.findFirst({
    where: { sourceId, status: { in: ["running", "paused"] } },
  });
  if (active) {
    throw new Error("An import for this source is already running — pause or cancel it first.");
  }

  const job = await prisma.importJob.create({
    data: {
      sourceId,
      kind,
      status: "running",
      total: items.length,
      items: JSON.stringify(items),
      trigger: opts.trigger ?? "manual",
      retryOfId: opts.retryOfId,
    },
    include: { source: { select: { name: true } } },
  });
  await prisma.source.update({ where: { id: sourceId }, data: { status: "syncing" } });
  await audit(
    `${kind}.started`,
    `${kind === "sync" ? "Sync" : "Import"} of ${items.length} document${items.length === 1 ? "" : "s"} started for ${job.source.name}`,
    {
      entityType: "importJob",
      entityId: job.id,
      actor: opts.actor,
      detail: { sourceId, trigger: opts.trigger ?? "manual", retryOfId: opts.retryOfId },
    }
  );

  // Runs after the response is sent. `after()` keeps the serverless function
  // alive on Vercel (a bare fire-and-forget promise would be frozen); the loop
  // checks job status in the DB between items so pause/cancel still work.
  // If the function still dies mid-run, the cron runner picks the job back up
  // via the updatedAt heartbeat (see /api/cron/sync).
  after(() => runImportJob(job.id).catch((err) => markJobFailed(job.id, sourceId, err)));

  return job;
}

/** Record a crashed job + surface the reason on the source. */
export async function markJobFailed(jobId: string, sourceId: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  await prisma.importJob
    .update({
      where: { id: jobId },
      data: { status: "error", error: message, finishedAt: new Date(), current: null },
    })
    .catch(() => {});
  await prisma.source
    .update({ where: { id: sourceId }, data: { status: "error", lastSyncError: message } })
    .catch(() => {});
  await audit("sync.failed", `Job failed: ${message}`, {
    entityType: "importJob",
    entityId: jobId,
    actor: "system",
    detail: { sourceId },
  });
}

/** Resume a paused job (also used internally by startImportJob). */
export async function runImportJob(jobId: string): Promise<void> {
  const job = await prisma.importJob.findUniqueOrThrow({
    where: { id: jobId },
    include: { source: true },
  });
  if (job.status !== "running") return;

  const source = job.source;
  const config = JSON.parse(source.config ?? "{}") as Record<string, string>;
  const items = JSON.parse(job.items ?? "[]") as ImportItem[];
  const seenIds: string[] = [];

  let { imported, proposed, skipped, failed } = job;

  for (let i = job.cursor; i < items.length; i++) {
    // Re-read status so pause/cancel from the UI take effect between items
    const fresh = await prisma.importJob.findUnique({
      where: { id: jobId },
      select: { status: true },
    });
    if (!fresh || fresh.status === "cancelled") {
      await finishJob(jobId, source.id, "cancelled", { imported, proposed, skipped, failed });
      await log(
        `Import cancelled — ${imported} imported before stopping (${items.length - i} remaining)`,
        { sourceId: source.id }
      );
      return;
    }
    if (fresh.status === "paused") {
      // Save the cursor and exit — resume re-invokes runImportJob
      await prisma.importJob.update({
        where: { id: jobId },
        data: { cursor: i, imported, proposed, skipped, failed, current: null },
      });
      return;
    }

    const item = items[i];
    seenIds.push(item.externalId);

    try {
      await prisma.importJob.update({
        where: { id: jobId },
        data: { cursor: i, current: item.title, imported, proposed, skipped, failed },
      });

      const file = await fetchItem(source.type, config, item.externalId);
      const existing = await prisma.document.findUnique({
        where: { sourceId_externalId: { sourceId: source.id, externalId: item.externalId } },
      });

      if (!existing) {
        const doc = await prisma.document.create({
          data: {
            sourceId: source.id,
            externalId: item.externalId,
            title: file.title,
            content: file.content,
            excerpt: file.content.slice(0, 300),
            url: file.url,
            kind: file.kind,
          },
        });
        try {
          await indexDocument(doc.id);
        } catch (err) {
          // Don't leave a half-imported doc behind if indexing fails
          await prisma.document.delete({ where: { id: doc.id } }).catch(() => {});
          throw err;
        }
        imported++;
      } else if (existing.content !== file.content || existing.title !== file.title) {
        // Drift — queue a proposal instead of silently updating the index
        const pending = await prisma.proposal.findFirst({
          where: { documentId: existing.id, status: "pending", type: "update" },
        });
        if (pending) {
          await prisma.proposal.update({
            where: { id: pending.id },
            data: { newContent: file.content, newTitle: file.title },
          });
        } else {
          await prisma.proposal.create({
            data: {
              documentId: existing.id,
              type: "update",
              origin: "sync",
              reason: `Content changed on ${source.name} — the indexed version is out of date.`,
              oldContent: existing.content,
              newContent: file.content,
              newTitle: file.title,
            },
          });
        }
        proposed++;
      } else {
        skipped++;
      }
    } catch {
      failed++;
    }
  }

  // Full sync over everything the source has → propose archiving vanished docs
  if (job.kind === "sync") {
    const missing = await prisma.document.findMany({
      where: { sourceId: source.id, status: "indexed", externalId: { notIn: seenIds } },
    });
    for (const doc of missing) {
      const pending = await prisma.proposal.findFirst({
        where: { documentId: doc.id, status: "pending", type: "archive" },
      });
      if (!pending) {
        await prisma.proposal.create({
          data: {
            documentId: doc.id,
            type: "archive",
            origin: "sync",
            reason: `No longer present on ${source.name} — archive it from the knowledge base?`,
            oldContent: doc.content,
            newContent: "",
          },
        });
        proposed++;
      }
    }
  }

  await finishJob(jobId, source.id, "completed", { imported, proposed, skipped, failed });
  const parts = [
    imported && `${imported} imported & indexed`,
    proposed && `${proposed} proposal(s) queued for review`,
    skipped && `${skipped} unchanged`,
    failed && `${failed} failed`,
  ].filter(Boolean);
  const summary = parts.join(", ") || "nothing to do";
  await log(`${source.name} ${job.kind} finished — ${summary}`, { sourceId: source.id });
  await audit(`${job.kind}.completed`, `${source.name} ${job.kind} finished — ${summary}`, {
    entityType: "importJob",
    entityId: jobId,
    actor: "system",
    detail: { sourceId: source.id, imported, proposed, skipped, failed },
  });
}

async function finishJob(
  jobId: string,
  sourceId: string,
  status: "completed" | "cancelled",
  counts: { imported: number; proposed: number; skipped: number; failed: number }
) {
  await prisma.importJob.update({
    where: { id: jobId },
    data: { status, current: null, cursor: 0, finishedAt: new Date(), ...counts },
  });
  const source = await prisma.source.findUnique({
    where: { id: sourceId },
    select: { syncInterval: true },
  });
  await prisma.source.update({
    where: { id: sourceId },
    data: {
      status: "connected",
      lastSyncAt: new Date(),
      lastSyncError: null,
      // keep the schedule rolling from the completed run
      nextSyncAt: nextSyncAt(source?.syncInterval ?? "manual"),
    },
  });
}
