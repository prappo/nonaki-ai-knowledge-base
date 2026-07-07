import { NextRequest } from "next/server";
import { retrieve } from "@/lib/rag";
import { docIdsForSources } from "@/lib/scope";
import { getShareConfig } from "@/lib/share";

/** Public hybrid search scoped to the KB's published sources. */
export async function POST(req: NextRequest) {
  const { query } = (await req.json()) as { query?: string };
  if (!query?.trim()) {
    return Response.json({ error: "query is required" }, { status: 400 });
  }
  try {
    const config = await getShareConfig("kb");
    const docIds = await docIdsForSources(
      config.sourceIds.length > 0 ? config.sourceIds : undefined
    );
    const results = await retrieve(query, 10, docIds);
    return Response.json({
      results: results.map((r) => ({
        documentId: r.documentId,
        title: r.title,
        snippet: r.content.slice(0, 220),
        score: r.score,
      })),
    });
  } catch {
    return Response.json({ error: "Search failed" }, { status: 500 });
  }
}
