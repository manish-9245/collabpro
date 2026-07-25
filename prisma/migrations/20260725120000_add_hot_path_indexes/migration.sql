-- Issue #191: add indexes on columns that are read on every request via
-- authorization checks (checkFileAccess/checkTeamAccess in
-- app/api/state-sync/route.ts, verifyApiKey in lib/api-key-middleware.ts,
-- app/api/mcp/route.ts) or hot list/poll views (files:getFiles,
-- files:getVersions, presence, notifications). None of these lookups were
-- previously backed by an index, so every check was a sequential scan.

-- File: teamId is read on every files:getFiles / checkTeamAccess call;
-- createdBy is read on every personal-scope file listing. The composite
-- index matches files:getFiles' cursor pagination order (teamId filter,
-- createdAt desc, id desc tiebreaker) so paginated listing is a real
-- index-scan improvement, not just a smaller response.
CREATE INDEX "File_teamId_idx" ON "File"("teamId");
CREATE INDEX "File_createdBy_idx" ON "File"("createdBy");
CREATE INDEX "File_teamId_createdAt_id_idx" ON "File"("teamId", "createdAt", "id");

-- TeamMember: userEmail alone (not just the (teamId, userEmail) composite
-- covered by the existing unique index) is queried directly in
-- app/api/mcp/route.ts and org-scope team membership lookups.
CREATE INDEX "TeamMember_userEmail_idx" ON "TeamMember"("userEmail");

-- FilePresence: active-collaborator queries filter by fileId and range-scan
-- lastSeenAt on every presence poll.
CREATE INDEX "FilePresence_fileId_lastSeenAt_idx" ON "FilePresence"("fileId", "lastSeenAt");

-- Notification: notification center lists by userEmail ordered by createdAt.
CREATE INDEX "Notification_userEmail_createdAt_idx" ON "Notification"("userEmail", "createdAt");

-- FileVersion: version history lookups filter by fileId ordered by version.
-- UNIQUE (not just indexed): two concurrent files:createVersion calls for the
-- same file can both compute the same "next version number" under
-- read-committed isolation. This constraint turns that race into a
-- retryable unique-violation (handled in fileService.ts) instead of
-- silently allowing duplicate version numbers.
CREATE UNIQUE INDEX "FileVersion_fileId_version_key" ON "FileVersion"("fileId", "version");

-- Team: createdBy is read on every checkTeamAccess call and org-scope team
-- discovery (files:getFiles with scope=org).
CREATE INDEX "Team_createdBy_idx" ON "Team"("createdBy");

-- ApiKey: userEmail is read on every MCP/API-key authenticated request.
CREATE INDEX "ApiKey_userEmail_idx" ON "ApiKey"("userEmail");
