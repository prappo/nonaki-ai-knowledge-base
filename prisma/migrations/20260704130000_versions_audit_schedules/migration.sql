-- Source: sync scheduling + last failure reason
ALTER TABLE "Source" ADD COLUMN "lastSyncError" TEXT;
ALTER TABLE "Source" ADD COLUMN "syncInterval" TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE "Source" ADD COLUMN "nextSyncAt" TIMESTAMP(3);
CREATE INDEX "Source_nextSyncAt_idx" ON "Source"("nextSyncAt");

-- ImportJob: retry lineage + accurate duration
ALTER TABLE "ImportJob" ADD COLUMN "trigger" TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE "ImportJob" ADD COLUMN "retryOfId" TEXT;
ALTER TABLE "ImportJob" ADD COLUMN "finishedAt" TIMESTAMP(3);

-- Document: archive timestamp
ALTER TABLE "Document" ADD COLUMN "archivedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "DocumentVersion" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "origin" TEXT NOT NULL DEFAULT 'edit',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DocumentVersion_documentId_version_key" ON "DocumentVersion"("documentId", "version");
CREATE INDEX "DocumentVersion_documentId_createdAt_idx" ON "DocumentVersion"("documentId", "createdAt");

ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "summary" TEXT NOT NULL,
    "detail" TEXT,
    "actor" TEXT NOT NULL DEFAULT 'system',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");
