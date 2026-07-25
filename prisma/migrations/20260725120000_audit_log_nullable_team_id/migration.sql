-- Authentication events (login, failed login, registration, logout, API key
-- issue/revoke) have no team context, so AuditLog.teamId must be optional to
-- record them at all. The FK is also switched from CASCADE to SET NULL so
-- that deleting the audited team does not destroy the audit trail of the
-- events that happened against it.
--
-- The replacement FK is added as NOT VALID: this skips scanning existing
-- rows, so the ACCESS EXCLUSIVE lock this statement takes is brief and does
-- not block concurrent writes to AuditLog for the duration of a full-table
-- validation scan. The scan itself happens in the next migration
-- (20260725120001_audit_log_validate_team_fk) via VALIDATE CONSTRAINT in its
-- own transaction, which takes only a SHARE UPDATE EXCLUSIVE lock and does
-- not block concurrent reads/writes. Doing both steps in one transaction
-- would hold the ACCESS EXCLUSIVE lock for the validation scan too, since
-- Postgres does not release locks until COMMIT.

-- DropForeignKey
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_teamId_fkey";

-- AlterTable
ALTER TABLE "AuditLog" ALTER COLUMN "teamId" DROP NOT NULL;

-- AddForeignKey (NOT VALID — validated separately, see above)
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
