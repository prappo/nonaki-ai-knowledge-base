import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { extractText } from "@/lib/extract";
import { indexDocument, log } from "@/lib/indexer";
import { isImportingDisabled } from "@/lib/importer";

export const maxDuration = 300;

async function getUploadSource() {
  const existing = await prisma.source.findFirst({ where: { type: "upload" } });
  if (existing) return existing;
  return prisma.source.create({
    data: { type: "upload", name: "File uploads", status: "connected" },
  });
}

export async function POST(req: NextRequest) {
  if (isImportingDisabled()) {
    return Response.json({ error: "Data source importing is disabled" }, { status: 403 });
  }

  const formData = await req.formData();
  const files = formData.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return Response.json({ error: "No files provided" }, { status: 400 });
  }

  const source = await getUploadSource();
  const uploaded: { id: string; title: string; chunks: number }[] = [];
  const errors: { file: string; error: string }[] = [];

  for (const file of files) {
    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      const { text, kind } = await extractText(file.name, buffer);
      if (!text.trim()) throw new Error("No text could be extracted");

      const title = file.name.replace(/\.[^.]+$/, "");
      const doc = await prisma.document.upsert({
        where: {
          sourceId_externalId: { sourceId: source.id, externalId: file.name },
        },
        create: {
          sourceId: source.id,
          externalId: file.name,
          title,
          content: text,
          excerpt: text.slice(0, 300),
          kind,
        },
        update: {
          content: text,
          excerpt: text.slice(0, 300),
          status: "indexed",
          version: { increment: 1 },
        },
      });
      const chunks = await indexDocument(doc.id);
      uploaded.push({ id: doc.id, title: doc.title, chunks });
      await log(`${file.name} parsed → chunked into ${chunks} → indexed`, {
        sourceId: source.id,
      });
    } catch (err) {
      errors.push({
        file: file.name,
        error: err instanceof Error ? err.message : "Failed to process",
      });
    }
  }

  await prisma.source.update({
    where: { id: source.id },
    data: { lastSyncAt: new Date() },
  });

  return Response.json({ uploaded, errors }, { status: errors.length && !uploaded.length ? 422 : 200 });
}
