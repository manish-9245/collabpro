import { prisma } from '@/lib/db';

/**
 * Determines whether a user (identified by email) is allowed to access a
 * file: either they created it, or they are a member of the team the file
 * belongs to. Shared by any route that needs to authorize an operation
 * against a specific file (state-sync, share links, etc.) so the access
 * rule lives in exactly one place.
 */
export async function checkFileAccess(fileId: string, email: string): Promise<boolean> {
  if (!fileId) return false;
  const file = await prisma.file.findUnique({
    where: { id: fileId }
  });
  if (!file) return false;
  if (file.createdBy === email) return true;
  const teamMember = await prisma.teamMember.findFirst({
    where: {
      teamId: file.teamId,
      userEmail: email
    }
  });
  return !!teamMember;
}
