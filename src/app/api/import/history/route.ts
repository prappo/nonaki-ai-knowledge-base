import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Import/sync history, newest first.
 * Query params: page, perPage (max 100), status, sourceId, kind.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const perPage = Math.min(100, Math.max(10, Number(sp.get("perPage")) || 30));
  const status = sp.get("status")?.trim() ?? "";
  const sourceId = sp.get("sourceId")?.trim() ?? "";
  const kind = sp.get("kind")?.trim() ?? "";

  const where: Prisma.ImportJobWhereInput = {
    ...(status ? { status } : {}),
    ...(sourceId ? { sourceId } : {}),
    ...(kind ? { kind } : {}),
  };

  const [total, jobs, statusGroups, sources] = await Promise.all([
    prisma.importJob.count({ where }),
    prisma.importJob.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
      select: {
        id: true,
        kind: true,
        status: true,
        total: true,
        cursor: true,
        imported: true,
        proposed: true,
        skipped: true,
        failed: true,
        error: true,
        trigger: true,
        retryOfId: true,
        createdAt: true,
        updatedAt: true,
        finishedAt: true,
        source: { select: { id: true, name: true, type: true } },
      },
    }),
    prisma.importJob.groupBy({ by: ["status"], _count: { status: true } }),
    prisma.source.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, type: true, config: true },
    }),
  ]);

  return Response.json({
    jobs: jobs.map((j) => ({
      ...j,
      // pre-finishedAt rows fall back to the last heartbeat
      durationMs:
        j.status === "running" || j.status === "paused"
          ? Date.now() - j.createdAt.getTime()
          : ((j.finishedAt ?? j.updatedAt).getTime() - j.createdAt.getTime()),
    })),
    total,
    page,
    perPage,
    statuses: statusGroups.map((g) => ({ status: g.status, count: g._count.status })),
    sources: sources.map(({ config, ...s }) => ({ ...s, siteUrl: siteUrlFrom(config) })),
  });
}

/** Site URL for favicon display — never exposes tokens or other config. */
function siteUrlFrom(config: string | null): string | undefined {
  try {
    return (JSON.parse(config ?? "{}") as { url?: string }).url;
  } catch {
    return undefined;
  }
}
