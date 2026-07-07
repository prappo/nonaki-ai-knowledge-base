import { prisma } from "@/lib/prisma";

/** Lightweight stats for the top strip on every screen. */
export async function GET() {
  const [docs, chunks, pending, sources] = await Promise.all([
    prisma.document.count({ where: { status: "indexed" } }),
    prisma.document.aggregate({
      _sum: { chunkCount: true },
      where: { status: "indexed" },
    }),
    prisma.proposal.count({ where: { status: "pending" } }),
    prisma.source.count(),
  ]);
  return Response.json({
    docs,
    chunks: chunks._sum.chunkCount ?? 0,
    pending,
    sources,
  });
}
