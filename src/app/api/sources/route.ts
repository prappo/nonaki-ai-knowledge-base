import { prisma } from "@/lib/prisma";

/** Sources with per-source health: last/next sync, failure reason, doc + proposal counts, last job. */
export async function GET() {
  const [sources, pendingProposals] = await Promise.all([
    prisma.source.findMany({
      orderBy: { createdAt: "asc" },
      include: {
        _count: { select: { documents: { where: { status: "indexed" } } } },
        importJobs: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            kind: true,
            status: true,
            imported: true,
            proposed: true,
            skipped: true,
            failed: true,
            error: true,
            trigger: true,
            createdAt: true,
            finishedAt: true,
          },
        },
      },
    }),
    prisma.proposal.findMany({
      where: { status: "pending" },
      select: { document: { select: { sourceId: true } } },
    }),
  ]);

  const pendingBySource = new Map<string, number>();
  for (const p of pendingProposals) {
    const sid = p.document.sourceId;
    pendingBySource.set(sid, (pendingBySource.get(sid) ?? 0) + 1);
  }

  // Never ship tokens to the browser
  const safe = sources.map(({ importJobs, ...s }) => {
    const config = JSON.parse(s.config ?? "{}") as Record<string, string>;
    if (config.token) config.token = "•••";
    return {
      ...s,
      config: JSON.stringify(config),
      lastJob: importJobs[0] ?? null,
      pendingProposals: pendingBySource.get(s.id) ?? 0,
    };
  });
  return Response.json({ sources: safe });
}
