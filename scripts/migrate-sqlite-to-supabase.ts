/**
 * One-time data migration: copies everything from the local SQLite dev.db
 * into Supabase Postgres, PRESERVING primary keys — Weaviate chunks reference
 * Document.id, so IDs must survive the move.
 *
 * Usage: npx tsx scripts/migrate-sqlite-to-supabase.ts
 * (expects DATABASE_URL in .env to point at Supabase, and ./dev.db to exist)
 */
import "dotenv/config";
import Database from "better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

type Row = Record<string, unknown>;

const sqlite = new Database("dev.db", { readonly: true });
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

function toDate(v: unknown): Date | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return new Date(v);
  const s = String(v);
  const d = new Date(s.includes("T") ? s : s.replace(" ", "T") + "Z");
  return isNaN(d.getTime()) ? null : d;
}

const bool = (v: unknown) => v === 1 || v === true || v === "1";
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
const num = (v: unknown) => Number(v ?? 0);

function rows(table: string): Row[] {
  try {
    return sqlite.prepare(`SELECT * FROM "${table}"`).all() as Row[];
  } catch {
    return [];
  }
}

async function main() {
  console.log("→ Copying Sources…");
  for (const r of rows("Source")) {
    await prisma.source.upsert({
      where: { id: String(r.id) },
      update: {},
      create: {
        id: String(r.id),
        type: String(r.type),
        name: String(r.name),
        config: str(r.config),
        status: String(r.status ?? "connected"),
        enabled: bool(r.enabled ?? 1),
        lastSyncAt: toDate(r.lastSyncAt),
        createdAt: toDate(r.createdAt) ?? new Date(),
      },
    });
  }

  console.log("→ Copying Documents (IDs preserved for Weaviate)…");
  let docCount = 0;
  for (const r of rows("Document")) {
    await prisma.document.upsert({
      where: { id: String(r.id) },
      update: {},
      create: {
        id: String(r.id),
        sourceId: String(r.sourceId),
        externalId: str(r.externalId),
        title: String(r.title),
        content: String(r.content),
        excerpt: str(r.excerpt),
        url: str(r.url),
        kind: String(r.kind ?? "doc"),
        status: String(r.status ?? "indexed"),
        version: num(r.version ?? 1),
        chunkCount: num(r.chunkCount),
        verified: bool(r.verified ?? 1),
        createdAt: toDate(r.createdAt) ?? new Date(),
        updatedAt: toDate(r.updatedAt) ?? new Date(),
      },
    });
    docCount++;
  }

  console.log("→ Copying Proposals…");
  for (const r of rows("Proposal")) {
    await prisma.proposal.upsert({
      where: { id: String(r.id) },
      update: {},
      create: {
        id: String(r.id),
        documentId: String(r.documentId),
        type: String(r.type ?? "update"),
        origin: String(r.origin ?? "sync"),
        reason: str(r.reason),
        oldContent: String(r.oldContent ?? ""),
        newContent: String(r.newContent ?? ""),
        newTitle: str(r.newTitle),
        status: String(r.status ?? "pending"),
        createdAt: toDate(r.createdAt) ?? new Date(),
        resolvedAt: toDate(r.resolvedAt),
      },
    });
  }

  console.log("→ Copying SyncLogs…");
  for (const r of rows("SyncLog")) {
    await prisma.syncLog.upsert({
      where: { id: String(r.id) },
      update: {},
      create: {
        id: String(r.id),
        sourceId: str(r.sourceId),
        message: String(r.message),
        level: String(r.level ?? "info"),
        createdAt: toDate(r.createdAt) ?? new Date(),
      },
    });
  }

  console.log("→ Copying AskLogs…");
  for (const r of rows("AskLog")) {
    await prisma.askLog.upsert({
      where: { id: String(r.id) },
      update: {},
      create: {
        id: String(r.id),
        question: String(r.question),
        answer: str(r.answer),
        citations: str(r.citations),
        mode: String(r.mode ?? "ask"),
        createdAt: toDate(r.createdAt) ?? new Date(),
      },
    });
  }

  console.log("→ Copying Settings (incl. share configs & secrets)…");
  for (const r of rows("Setting")) {
    await prisma.setting.upsert({
      where: { key: String(r.key) },
      update: { value: String(r.value) },
      create: { key: String(r.key), value: String(r.value) },
    });
  }

  console.log("→ Copying finished ImportJobs (history)…");
  for (const r of rows("ImportJob")) {
    const status = String(r.status);
    if (status === "running" || status === "paused") continue; // don't resurrect dead runners
    await prisma.importJob.upsert({
      where: { id: String(r.id) },
      update: {},
      create: {
        id: String(r.id),
        sourceId: String(r.sourceId),
        kind: String(r.kind ?? "import"),
        status,
        total: num(r.total),
        cursor: num(r.cursor),
        imported: num(r.imported),
        proposed: num(r.proposed),
        skipped: num(r.skipped),
        failed: num(r.failed),
        items: str(r.items),
        current: str(r.current),
        error: str(r.error),
        createdAt: toDate(r.createdAt) ?? new Date(),
      },
    });
  }

  const [sources, docs, proposals] = await Promise.all([
    prisma.source.count(),
    prisma.document.count(),
    prisma.proposal.count(),
  ]);
  console.log(
    `✓ Done — Postgres now has ${sources} sources, ${docs} documents (${docCount} copied), ${proposals} proposals.`
  );
  await prisma.$disconnect();
  sqlite.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
