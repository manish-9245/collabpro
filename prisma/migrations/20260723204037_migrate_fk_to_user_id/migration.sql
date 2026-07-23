-- AlterTable: TeamMember
ALTER TABLE "TeamMember" ADD COLUMN "userId" TEXT;
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "TeamMember_teamId_userId_key" ON "TeamMember"("teamId", "userId");

-- AlterTable: FilePresence
ALTER TABLE "FilePresence" ADD COLUMN "userId" TEXT;
ALTER TABLE "FilePresence" ADD CONSTRAINT "FilePresence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "FilePresence_fileId_userId_key" ON "FilePresence"("fileId", "userId");

-- AlterTable: Invitation
ALTER TABLE "Invitation" ADD COLUMN "inviterId" TEXT;
ALTER TABLE "Invitation" ADD COLUMN "inviteeId" TEXT;
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_inviteeId_fkey" FOREIGN KEY ("inviteeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: Notification
ALTER TABLE "Notification" ADD COLUMN "userId" TEXT;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: ApiKey
ALTER TABLE "ApiKey" ADD COLUMN "userId" TEXT;
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
