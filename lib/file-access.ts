import { prisma } from '@/lib/db';

/**
 * Determines whether a user (identified by email) is allowed to access a
 * file: they created it, they created the team the file belongs to, or
 * they are a member of that team. Shared by any route that needs to
 * authorize an operation against a specific file (state-sync, share links,
 * etc.) so the access rule lives in exactly one place.
 *
 * Team creation does not automatically create a TeamMember row for the
 * creator, so the team-ownership check is required in addition to
 * TeamMember lookup — otherwise a team owner loses access to files a
 * teammate created within their own team.
 */
export async function checkFileAccess(fileId: string, email: string): Promise<boolean> {
  if (!fileId) return false;
  const file = await prisma.file.findUnique({
    where: { id: fileId },
    include: { team: true }
  });
  if (!file) return false;
  if (file.createdBy === email) return true;
  if (file.team && file.team.createdBy === email) return true;
  const teamMember = await prisma.teamMember.findFirst({
    where: {
      teamId: file.teamId,
      userEmail: email
    }
  });
  return !!teamMember;
}
