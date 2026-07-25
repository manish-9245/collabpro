-- CONCURRENTLY avoids the write-blocking lock a plain CREATE INDEX would
-- hold on AuditLog for the duration of the index build.
--
-- This file must contain exactly this one statement and nothing else:
-- Postgres refuses to run CREATE INDEX CONCURRENTLY inside a transaction
-- block at all, and Prisma's migration engine only skips wrapping a
-- migration.sql in an implicit transaction when the file contains a single
-- statement. Adding any other statement here would re-introduce the
-- transaction wrapper and make this migration fail outright.
CREATE INDEX CONCURRENTLY "AuditLog_userEmail_createdAt_idx" ON "AuditLog"("userEmail", "createdAt");
