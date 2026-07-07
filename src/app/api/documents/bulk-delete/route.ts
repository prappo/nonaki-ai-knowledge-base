import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { deindexDocument, log } from "@/lib/indexer";
import { audit, currentActor } from "@/lib/audit";

/**
 * Archive (default) or permanently delete multiple documents at once.
 * body: { ids: string[], permanent?: boolean }
 * Each doc's chunks are removed from Weaviate; archived docs stay restorable.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as { ids?: string[]; permanent?: boolean };
  const ids = [...new Set(body.ids ?? [])].filter(Boolean);
  const permanent = body.permanent === true;
  if (ids.length === 0) {
    return Response.json({ error: "ids is required" }, { status: 400 });
  }
  if (ids.length > 200) {
    return Response.json({ error: "Max 200 documents per request" }, { status: 400 });
  }

  const docs = await prisma.document.findMany({
    where: { id: { in: ids } },
    select: { id: true, title: true },
  });

  const actor = await currentActor();
  let deleted = 0;
  const errors: { id: string; error: string }[] = [];

  for (const doc of docs) {
    try {
      await deindexDocument(doc.id);
      if (permanent) {
        await prisma.document.delete({ where: { id: doc.id } });
      } else {
        await prisma.document.update({
          where: { id: doc.id },
          data: { status: "archived", archivedAt: new Date(), chunkCount: 0 },
        });
      }
      deleted++;
    } catch (err) {
      errors.push({
        id: doc.id,
        error: err instanceof Error ? err.message : "Failed to delete",
      });
    }
  }

  if (deleted > 0) {
    const verb = permanent ? "permanently deleted" : "archived";
    await log(
      `${deleted} document${deleted === 1 ? "" : "s"} ${verb} — removed from the Weaviate index`
    );
    await audit(
      permanent ? "document.deleted" : "document.archived",
      `Bulk ${verb} ${deleted} document${deleted === 1 ? "" : "s"}`,
      { entityType: "document", actor, detail: { ids: docs.map((d) => d.id) } }
    );
  }

  return Response.json({ deleted, errors });
}
