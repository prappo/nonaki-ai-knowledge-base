import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { listItems, applySelection, startImportJob, type Selection } from "@/lib/importer";
import { normalizeWpUrl } from "@/lib/wordpress";
import { normalizeRepo } from "@/lib/github";
import { log } from "@/lib/indexer";
import { audit } from "@/lib/audit";

export const maxDuration = 120;

/**
 * Start a background import job.
 * body:
 *   { sourceId, kind?: "sync" }                      → re-sync an existing source
 *   { type, config, name?, selection? }              → connect a new source and import
 * selection: { mode: "all" } (default) | { mode: "count", count } | { mode: "select", selected: [] }
 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    sourceId?: string;
    type?: string;
    config?: Record<string, string>;
    name?: string;
    kind?: "import" | "sync";
    selection?: Selection;
  };

  try {
    let sourceId = body.sourceId;
    let type: string;
    let config: Record<string, string>;

    if (sourceId) {
      const source = await prisma.source.findUnique({ where: { id: sourceId } });
      if (!source) return Response.json({ error: "Source not found" }, { status: 404 });
      type = source.type;
      config = JSON.parse(source.config ?? "{}");
    } else {
      if (!body.type || !body.config) {
        return Response.json({ error: "type and config are required" }, { status: 400 });
      }
      type = body.type;
      config = { ...body.config };
      if (type === "wordpress") {
        if (!config.url) return Response.json({ error: "url is required" }, { status: 400 });
        config.url = normalizeWpUrl(config.url);
      } else if (type === "github") {
        if (!config.repo) return Response.json({ error: "repo is required" }, { status: 400 });
        config.repo = normalizeRepo(config.repo);
      } else {
        return Response.json({ error: `Unsupported source type "${type}"` }, { status: 400 });
      }

      const key = type === "wordpress" ? config.url : config.repo;
      const existing = await prisma.source.findFirst({
        where: { type, config: { contains: key } },
      });
      if (existing) {
        sourceId = existing.id;
      } else {
        const name =
          body.name ||
          (type === "wordpress" ? new URL(config.url).hostname : config.repo);
        const source = await prisma.source.create({
          data: { type, name, config: JSON.stringify(config), status: "connected" },
        });
        sourceId = source.id;
        await log(
          type === "wordpress"
            ? `WordPress connected — ${config.url}`
            : `GitHub connected — ${config.repo}${config.token ? " (private access)" : ""}`,
          { sourceId }
        );
        await audit("source.connected", `Connected ${type} source ${name}`, {
          entityType: "source",
          entityId: sourceId,
          detail: { type, key },
        });
      }
    }

    const allItems = await listItems(type, config);
    const kind = body.kind === "sync" ? "sync" : "import";
    const items =
      kind === "sync" ? allItems : applySelection(allItems, body.selection ?? { mode: "all" });

    if (items.length === 0) {
      return Response.json({ error: "Nothing selected to import" }, { status: 400 });
    }

    const job = await startImportJob(sourceId!, items, kind);
    return Response.json({ job: { id: job.id, total: job.total }, sourceId });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Import failed to start" },
      { status: 502 }
    );
  }
}
