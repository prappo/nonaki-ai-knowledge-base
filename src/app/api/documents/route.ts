import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { indexDocument, log } from "@/lib/indexer";
import { audit } from "@/lib/audit";
import type { Prisma } from "@/generated/prisma/client";

const WITHIN_MS: Record<string, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

/**
 * Paginated document list.
 * Query params:
 *   page, perPage (max 100)
 *   q            — title/source text filter
 *   kind         — doc type
 *   sourceId     — limit to one source
 *   status       — "indexed" | "archived" (default: all)
 *   verified     — "1" | "0"
 *   drift        — "1" → only docs with pending proposals
 *   updatedWithin— "24h" | "7d" | "30d"
 *   minChunks    — minimum chunk count
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const perPage = Math.min(100, Math.max(5, Number(sp.get("perPage")) || 25));
  const q = sp.get("q")?.trim() ?? "";
  const kind = sp.get("kind")?.trim() ?? "";
  const sourceId = sp.get("sourceId")?.trim() ?? "";
  const status = sp.get("status")?.trim() ?? "";
  const verified = sp.get("verified");
  const drift = sp.get("drift") === "1";
  const updatedWithin = sp.get("updatedWithin")?.trim() ?? "";
  const minChunks = Number(sp.get("minChunks")) || 0;

  const textFilter: Prisma.DocumentWhereInput = q
    ? {
        OR: [
          { title: { contains: q, mode: "insensitive" } },
          { source: { name: { contains: q, mode: "insensitive" } } },
        ],
      }
    : {};

  const where: Prisma.DocumentWhereInput = {
    ...textFilter,
    ...(kind ? { kind } : {}),
    ...(sourceId ? { sourceId } : {}),
    ...(status ? { status } : {}),
    ...(verified === "1" || verified === "0" ? { verified: verified === "1" } : {}),
    ...(drift ? { proposals: { some: { status: "pending" } } } : {}),
    ...(WITHIN_MS[updatedWithin]
      ? { updatedAt: { gte: new Date(Date.now() - WITHIN_MS[updatedWithin]) } }
      : {}),
    ...(minChunks > 0 ? { chunkCount: { gte: minChunks } } : {}),
  };

  const [total, documents, kindGroups, sources] = await Promise.all([
    prisma.document.count({ where }),
    prisma.document.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
      select: {
        id: true,
        title: true,
        excerpt: true,
        kind: true,
        status: true,
        verified: true,
        version: true,
        chunkCount: true,
        url: true,
        updatedAt: true,
        source: { select: { id: true, name: true, type: true } },
        _count: { select: { proposals: { where: { status: "pending" } } } },
      },
    }),
    // available types (respects the text filter so counts stay meaningful)
    prisma.document.groupBy({
      by: ["kind"],
      where: textFilter,
      _count: { kind: true },
      orderBy: { _count: { kind: "desc" } },
    }),
    prisma.source.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, type: true, config: true },
    }),
  ]);

  const kinds = kindGroups.map((g) => ({ kind: g.kind, count: g._count.kind }));

  return Response.json({
    documents,
    total,
    page,
    perPage,
    kinds,
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

async function getManualSource() {
  const existing = await prisma.source.findFirst({ where: { type: "manual" } });
  if (existing) return existing;
  return prisma.source.create({
    data: { type: "manual", name: "Manual entries", status: "connected" },
  });
}

/**
 * Create a document by hand — written directly in the app rather than imported.
 * body: { title, content }. Chunked & indexed in Weaviate immediately.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as { title?: string; content?: string };
  const title = body.title?.trim();
  const content = body.content?.trim();
  if (!title || !content) {
    return Response.json({ error: "title and content are required" }, { status: 400 });
  }

  const source = await getManualSource();
  const doc = await prisma.document.create({
    data: {
      sourceId: source.id,
      title,
      content,
      excerpt: content.slice(0, 300),
      kind: "note",
    },
  });

  try {
    const chunks = await indexDocument(doc.id);
    await prisma.source.update({
      where: { id: source.id },
      data: { lastSyncAt: new Date() },
    });
    await log(`"${title}" written manually — chunked into ${chunks} and indexed`, {
      sourceId: source.id,
    });
    await audit("document.created", `Created "${title}" manually`, {
      entityType: "document",
      entityId: doc.id,
      detail: { chunks },
    });
    return Response.json({ document: doc, chunks });
  } catch (err) {
    // Don't leave a half-created doc behind if indexing fails
    await prisma.document.delete({ where: { id: doc.id } }).catch(() => {});
    return Response.json(
      { error: err instanceof Error ? err.message : "Indexing failed" },
      { status: 502 }
    );
  }
}
