-- AlterTable: Team
ALTER TABLE "Team" ADD COLUMN "userId" TEXT;
ALTER TABLE "Team" ADD CONSTRAINT "Team_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: TeamMember
ALTER TABLE "TeamMember" ADD COLUMN "userId" TEXT;
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE UNIQUE INDEX "TeamMember_teamId_userId_key" ON "TeamMember"("teamId", "userId");

-- AlterTable: FilePresence
ALTER TABLE "FilePresence" ADD COLUMN "userId" TEXT;
ALTER TABLE "FilePresence" ADD CONSTRAINT "FilePresence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE UNIQUE INDEX "FilePresence_fileId_userId_key" ON "FilePresence"("fileId", "userId");

-- AlterTable: Invitation
ALTER TABLE "Invitation" ADD COLUMN "inviterId" TEXT;
ALTER TABLE "Invitation" ADD COLUMN "inviteeId" TEXT;
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_inviteeId_fkey" FOREIGN KEY ("inviteeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: Notification
ALTER TABLE "Notification" ADD COLUMN "userId" TEXT;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: ApiKey
ALTER TABLE "ApiKey" ADD COLUMN "userId" TEXT;
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill Team.userId from User.email via createdBy
UPDATE "Team" t SET "userId" = u."id" FROM "User" u WHERE t."createdBy" = u."email";

-- Backfill TeamMember.userId from User.email via userEmail
UPDATE "TeamMember" tm SET "userId" = u."id" FROM "User" u WHERE tm."userEmail" = u."email";

-- Backfill FilePresence.userId from User.email via userEmail
UPDATE "FilePresence" fp SET "userId" = u."id" FROM "User" u WHERE fp."userEmail" = u."email";

-- Backfill Invitation.inviterId from User.email via inviterEmail
UPDATE "Invitation" i SET "inviterId" = u."id" FROM "User" u WHERE i."inviterEmail" = u."email";

-- Backfill Invitation.inviteeId from User.email via inviteeEmail
UPDATE "Invitation" i SET "inviteeId" = u."id" FROM "User" u WHERE i."inviteeEmail" = u."email";

-- Backfill Notification.userId from User.email via userEmail
UPDATE "Notification" n SET "userId" = u."id" FROM "User" u WHERE n."userEmail" = u."email";

-- Backfill ApiKey.userId from User.email via userEmail
UPDATE "ApiKey" ak SET "userId" = u."id" FROM "User" u WHERE ak."userEmail" = u."email";
