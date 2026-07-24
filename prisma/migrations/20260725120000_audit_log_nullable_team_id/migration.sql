-- Authentication events (login, failed login, registration, logout, API key
-- issue/revoke) have no team context, so AuditLog.teamId must be optional to
-- record them at all. The FK is also switched from CASCADE to SET NULL so
-- that deleting the audited team does not destroy the audit trail of the
-- events that happened against it.

-- DropForeignKey
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_teamId_fkey";

-- AlterTable
ALTER TABLE "AuditLog" ALTER COLUMN "teamId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "AuditLog_userEmail_createdAt_idx" ON "AuditLog"("userEmail", "createdAt");
