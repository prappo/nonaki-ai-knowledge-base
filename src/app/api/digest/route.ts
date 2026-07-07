import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  // sources page asks for a longer feed than the digest screen's default 8
  const logLimit = Math.min(50, Math.max(1, Number(req.nextUrl.searchParams.get("logs")) || 8));

  const [
    docsIndexed,
    totalChunks,
    eventsWatched,
    driftedThisWeek,
    pendingProposals,
    approvedThisWeek,
    recentResolved,
    pendingList,
    recentLogs,
    answersThisWeek,
  ] = await Promise.all([
    prisma.document.count({ where: { status: "indexed" } }),
    prisma.document.aggregate({ _sum: { chunkCount: true }, where: { status: "indexed" } }),
    prisma.syncLog.count({ where: { createdAt: { gte: weekAgo } } }),
    prisma.proposal.count({ where: { createdAt: { gte: weekAgo } } }),
    prisma.proposal.count({ where: { status: "pending" } }),
    prisma.proposal.count({
      where: { status: "approved", resolvedAt: { gte: weekAgo } },
    }),
    prisma.proposal.findMany({
      where: { status: { in: ["approved", "rejected"] } },
      orderBy: { resolvedAt: "desc" },
      take: 6,
      include: {
        document: {
          select: { title: true, source: { select: { name: true, type: true } } },
        },
      },
    }),
    prisma.proposal.findMany({
      where: { status: "pending" },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: {
        document: {
          select: { id: true, title: true, source: { select: { name: true, type: true } } },
        },
      },
    }),
    prisma.syncLog.findMany({ orderBy: { createdAt: "desc" }, take: logLimit }),
    prisma.askLog.count({ where: { createdAt: { gte: weekAgo } } }),
  ]);

  return Response.json({
    stats: {
      docsIndexed,
      chunksIndexed: totalChunks._sum.chunkCount ?? 0,
      eventsWatched,
      driftedThisWeek,
      pendingProposals,
      approvedThisWeek,
      answersThisWeek,
    },
    pendingList,
    recentResolved,
    recentLogs,
  });
}
