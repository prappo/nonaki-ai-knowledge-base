-- CreateTable
CREATE TABLE "ReleaseAgent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "capabilities" TEXT NOT NULL DEFAULT '[]',
    "repos" TEXT NOT NULL DEFAULT '[]',
    "version" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReleaseAgent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReleasePairing" (
    "code" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReleasePairing_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "ReleaseCommand" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "result" TEXT,
    "actor" TEXT NOT NULL DEFAULT 'system',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),

    CONSTRAINT "ReleaseCommand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReleaseSnapshot" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReleaseSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReleaseRun" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "snapshot" TEXT NOT NULL,
    "costUsd" DOUBLE PRECISION,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReleaseRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReleaseAgent_tokenHash_key" ON "ReleaseAgent"("tokenHash");

-- CreateIndex
CREATE INDEX "ReleaseCommand_agentId_status_createdAt_idx" ON "ReleaseCommand"("agentId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ReleaseSnapshot_agentId_repoId_idx" ON "ReleaseSnapshot"("agentId", "repoId");

-- CreateIndex
CREATE INDEX "ReleaseRun_agentId_repoId_version_startedAt_idx" ON "ReleaseRun"("agentId", "repoId", "version", "startedAt");

-- AddForeignKey
ALTER TABLE "ReleaseCommand" ADD CONSTRAINT "ReleaseCommand_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "ReleaseAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseSnapshot" ADD CONSTRAINT "ReleaseSnapshot_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "ReleaseAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseRun" ADD CONSTRAINT "ReleaseRun_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "ReleaseAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

