import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Paginated audit trail.
 * Query params: page, perPage (max 100), category (action prefix, e.g. "document"), actor.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const perPage = Math.min(100, Math.max(10, Number(sp.get("perPage")) || 50));
  const category = sp.get("category")?.trim() ?? "";
  const actor = sp.get("actor")?.trim() ?? "";

  const where = {
    ...(category ? { action: { startsWith: `${category}.` } } : {}),
    ...(actor ? { actor } : {}),
  };

  const [total, events, actionGroups, actorGroups] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.auditLog.groupBy({ by: ["action"], _count: { action: true } }),
    prisma.auditLog.groupBy({ by: ["actor"], _count: { actor: true } }),
  ]);

  // "document.deleted" → category "document", with counts rolled up
  const categories = new Map<string, number>();
  for (const g of actionGroups) {
    const cat = g.action.split(".")[0];
    categories.set(cat, (categories.get(cat) ?? 0) + g._count.action);
  }

  return Response.json({
    events,
    total,
    page,
    perPage,
    categories: [...categories.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    actors: actorGroups
      .map((g) => ({ name: g.actor, count: g._count.actor }))
      .sort((a, b) => b.count - a.count),
  });
}
