-- Validates the FK added as NOT VALID in 20260725120000_audit_log_nullable_team_id.
-- This is intentionally its own migration file (and thus its own transaction):
-- Postgres holds locks until COMMIT, so running this in the same transaction
-- as the ADD CONSTRAINT statement would hold that statement's brief ACCESS
-- EXCLUSIVE lock for the duration of this full-table scan. Run separately,
-- VALIDATE CONSTRAINT only takes a SHARE UPDATE EXCLUSIVE lock, which does
-- not block concurrent reads/writes to AuditLog.
ALTER TABLE "AuditLog" VALIDATE CONSTRAINT "AuditLog_teamId_fkey";
