import { prisma } from "@/lib/prisma";

/** Version history for a document (newest first, without full content). */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const doc = await prisma.document.findUnique({
    where: { id },
    select: { id: true, version: true },
  });
  if (!doc) return Response.json({ error: "Not found" }, { status: 404 });

  const versions = await prisma.documentVersion.findMany({
    where: { documentId: id },
    orderBy: { version: "desc" },
    select: { id: true, version: true, title: true, origin: true, createdAt: true },
  });
  return Response.json({ versions, currentVersion: doc.version });
}
