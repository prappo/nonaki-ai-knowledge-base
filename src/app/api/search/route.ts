import { NextRequest } from "next/server";
import { retrieve, toRetrievalMode } from "@/lib/rag";
import { prisma } from "@/lib/prisma";
import { docIdsForSources } from "@/lib/scope";

export async function POST(req: NextRequest) {
  const { query, sourceIds, retrieval } = (await req.json()) as {
    query?: string;
    sourceIds?: string[];
    retrieval?: string;
  };
  if (!query?.trim()) {
    return Response.json({ error: "query is required" }, { status: 400 });
  }

  try {
    const docIds = await docIdsForSources(sourceIds);
    const chunks = await retrieve(query, 12, docIds, toRetrievalMode(retrieval));
    prisma.askLog
      .create({ data: { question: query, mode: "search" } })
      .catch(() => {});
    return Response.json({ results: chunks });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Search failed" },
      { status: 500 }
    );
  }
}
