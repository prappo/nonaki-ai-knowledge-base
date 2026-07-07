import { prisma } from "@/lib/prisma";
import { listItems, startImportJob, isImportingDisabled } from "@/lib/importer";

export const maxDuration = 120;

/** Re-sync a source as a background job (drift → proposals, new → indexed). */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (isImportingDisabled()) {
    return Response.json({ error: "Data source importing is disabled" }, { status: 403 });
  }

  const { id } = await params;
  const source = await prisma.source.findUnique({ where: { id } });
  if (!source) return Response.json({ error: "Source not found" }, { status: 404 });
  if (source.type === "upload" || source.type === "manual") {
    return Response.json({ error: "This source has nothing to sync" }, { status: 400 });
  }

  try {
    const config = JSON.parse(source.config ?? "{}") as Record<string, string>;
    const items = await listItems(source.type, config);
    const job = await startImportJob(id, items, "sync");
    return Response.json({ job: { id: job.id, total: job.total } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed to start";
    await prisma.source.update({
      where: { id },
      data: { status: "error", lastSyncError: message },
    });
    return Response.json({ error: message }, { status: 502 });
  }
}
