import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { listItems } from "@/lib/importer";
import { normalizeWpUrl } from "@/lib/wordpress";
import { normalizeRepo } from "@/lib/github";

export const maxDuration = 120;

/**
 * Preview what a source would import: returns the full item list so the UI
 * can offer "import all / first N / select manually".
 * body: { type, config } for a new source, or { sourceId } for an existing one.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    sourceId?: string;
    type?: string;
    config?: Record<string, string>;
  };

  let type = body.type;
  let config = body.config;

  if (body.sourceId) {
    const source = await prisma.source.findUnique({ where: { id: body.sourceId } });
    if (!source) return Response.json({ error: "Source not found" }, { status: 404 });
    type = source.type;
    config = JSON.parse(source.config ?? "{}");
  }

  if (!type || !config) {
    return Response.json({ error: "type and config (or sourceId) are required" }, { status: 400 });
  }
  if (type === "wordpress" && config.url) config.url = normalizeWpUrl(config.url);
  if (type === "github" && config.repo) config.repo = normalizeRepo(config.repo);

  try {
    const items = await listItems(type, config);
    return Response.json({ items });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Preview failed" },
      { status: 502 }
    );
  }
}
