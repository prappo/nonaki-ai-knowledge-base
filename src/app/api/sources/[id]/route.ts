import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { deindexDocuments, log } from "@/lib/indexer";
import { audit } from "@/lib/audit";
import { isSyncInterval, nextSyncAt } from "@/lib/schedule";

export const maxDuration = 120;

/**
 * Update a source's sync schedule.
 * body: { syncInterval: "manual" | "hourly" | "daily" | "weekly" }
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await req.json()) as { syncInterval?: string };

  const source = await prisma.source.findUnique({ where: { id } });
  if (!source) return Response.json({ error: "Source not found" }, { status: 404 });

  if (!body.syncInterval || !isSyncInterval(body.syncInterval)) {
    return Response.json(
      { error: "syncInterval must be manual, hourly, daily or weekly" },
      { status: 400 }
    );
  }
  if ((source.type === "upload" || source.type === "manual") && body.syncInterval !== "manual") {
    return Response.json({ error: "This source has nothing to sync" }, { status: 400 });
  }

  const updated = await prisma.source.update({
    where: { id },
    data: {
      syncInterval: body.syncInterval,
      nextSyncAt: nextSyncAt(body.syncInterval),
    },
  });
  await audit(
    "source.schedule_changed",
    `Sync schedule for ${source.name} set to ${body.syncInterval}`,
    { entityType: "source", entityId: id, detail: { from: source.syncInterval } }
  );
  return Response.json({
    source: { id: updated.id, syncInterval: updated.syncInterval, nextSyncAt: updated.nextSyncAt },
  });
}

/** Disconnect a source: de-index all of its documents, then delete it. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const source = await prisma.source.findUnique({
    where: { id },
    include: { documents: { select: { id: true } } },
  });
  if (!source) return Response.json({ error: "Source not found" }, { status: 404 });

  await deindexDocuments(source.documents.map((d) => d.id)).catch(() => {});
  await prisma.source.delete({ where: { id } });
  await log(`Source "${source.name}" disconnected — ${source.documents.length} docs removed from index`);
  await audit("source.disconnected", `Disconnected ${source.name}`, {
    entityType: "source",
    entityId: id,
    detail: { type: source.type, documents: source.documents.length },
  });

  return Response.json({ ok: true });
}
