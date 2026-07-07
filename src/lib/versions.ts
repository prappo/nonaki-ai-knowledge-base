import { prisma } from "./prisma";

export type VersionOrigin = "edit" | "proposal" | "sync" | "restore";

/**
 * Snapshot a document's current title/content before it gets replaced, so the
 * change can be inspected and rolled back later. Idempotent per (doc, version):
 * if a snapshot for this version already exists it is left untouched.
 */
export async function snapshotVersion(
  doc: { id: string; version: number; title: string; content: string },
  origin: VersionOrigin
): Promise<void> {
  await prisma.documentVersion.upsert({
    where: { documentId_version: { documentId: doc.id, version: doc.version } },
    create: {
      documentId: doc.id,
      version: doc.version,
      title: doc.title,
      content: doc.content,
      origin,
    },
    update: {},
  });
}
