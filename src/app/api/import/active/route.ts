import { prisma } from "@/lib/prisma";

/** Active (running / paused) jobs + just-finished ones so the bar can flash completion. */
export async function GET() {
  const cutoff = new Date(Date.now() - 12_000);
  const jobs = await prisma.importJob.findMany({
    where: {
      OR: [
        { status: { in: ["running", "paused"] } },
        { status: { in: ["completed", "cancelled", "error"] }, updatedAt: { gte: cutoff } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 3,
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
      current: true,
      error: true,
      source: { select: { name: true, type: true } },
    },
  });
  return Response.json({ jobs });
}
