-- Issue #191: add indexes on columns that are read on every request via
-- authorization checks (checkFileAccess/checkTeamAccess in
-- app/api/state-sync/route.ts, verifyApiKey in lib/api-key-middleware.ts,
-- app/api/mcp/route.ts) or hot list/poll views (files:getFiles,
-- files:getVersions, presence, notifications). None of these lookups were
-- previously backed by an index, so every check was a sequential scan.

-- File: teamId is read on every files:getFiles / checkTeamAccess call;
-- createdBy is read on every personal-scope file listing.
CREATE INDEX "File_teamId_idx" ON "File"("teamId");
CREATE INDEX "File_createdBy_idx" ON "File"("createdBy");

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
CREATE INDEX "FileVersion_fileId_version_idx" ON "FileVersion"("fileId", "version");

-- Team: createdBy is read on every checkTeamAccess call and org-scope team
-- discovery (files:getFiles with scope=org).
CREATE INDEX "Team_createdBy_idx" ON "Team"("createdBy");

-- ApiKey: userEmail is read on every MCP/API-key authenticated request.
CREATE INDEX "ApiKey_userEmail_idx" ON "ApiKey"("userEmail");
