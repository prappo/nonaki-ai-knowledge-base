import { prisma } from "@/lib/prisma";
import { getShareConfig } from "@/lib/share";

/** Public data for the hosted knowledge-base site. */
export async function GET() {
  const config = await getShareConfig("kb");
  const docs = await prisma.document.findMany({
    where: {
      status: "indexed",
      ...(config.sourceIds.length > 0 ? { sourceId: { in: config.sourceIds } } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: 500,
    select: {
      id: true,
      title: true,
      excerpt: true,
      kind: true,
      updatedAt: true,
      source: { select: { name: true } },
    },
  });
  return Response.json({ config, docs });
}
