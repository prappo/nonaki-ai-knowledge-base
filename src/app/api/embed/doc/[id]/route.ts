import { prisma } from "@/lib/prisma";
import { getShareConfig } from "@/lib/share";

/** Public read of one document — only if its source is published to the KB. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const config = await getShareConfig("kb");
  const doc = await prisma.document.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      content: true,
      kind: true,
      status: true,
      sourceId: true,
      updatedAt: true,
      source: { select: { name: true } },
    },
  });
  if (
    !doc ||
    doc.status !== "indexed" ||
    (config.sourceIds.length > 0 && !config.sourceIds.includes(doc.sourceId))
  ) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json({ doc });
}
