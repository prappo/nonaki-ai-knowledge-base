-- Tasks can stand alone (no project) and be assigned to a user.
ALTER TABLE "ProjectTask" ALTER COLUMN "projectId" DROP NOT NULL;
ALTER TABLE "ProjectTask" ADD COLUMN "assignee" TEXT;
ALTER TABLE "ProjectTask" ADD COLUMN "createdBy" TEXT;

-- CreateIndex
CREATE INDEX "ProjectTask_assignee_status_idx" ON "ProjectTask"("assignee", "status");

-- CreateIndex
CREATE INDEX "ProjectTask_status_dueDate_idx" ON "ProjectTask"("status", "dueDate");
