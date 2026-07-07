import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const proposals = await prisma.proposal.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    include: {
      document: {
        select: {
          id: true,
          title: true,
          version: true,
          source: { select: { id: true, name: true, type: true } },
        },
      },
    },
  });
  return Response.json({ proposals });
}

/** Create a manual update proposal (e.g. edited in the doc editor). */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    documentId?: string;
    newContent?: string;
    newTitle?: string;
    reason?: string;
  };
  if (!body.documentId || !body.newContent?.trim()) {
    return Response.json(
      { error: "documentId and newContent are required" },
      { status: 400 }
    );
  }

  const doc = await prisma.document.findUnique({ where: { id: body.documentId } });
  if (!doc) return Response.json({ error: "Document not found" }, { status: 404 });

  const proposal = await prisma.proposal.create({
    data: {
      documentId: doc.id,
      type: "update",
      origin: "manual",
      reason: body.reason ?? "Manually edited draft awaiting approval.",
      oldContent: doc.content,
      newContent: body.newContent,
      newTitle: body.newTitle,
    },
  });
  return Response.json({ proposal });
}
