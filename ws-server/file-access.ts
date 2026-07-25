/**
 * File access check for the standalone WebSocket gateway (issue #198).
 *
 * Previously this pulled the *entire* file row (including the full
 * document/whiteboard JSON blobs) via `prisma.file.findUnique({ where: { id:
 * fileId } })` with no `select`, on every single cursor message — the
 * highest-frequency message type in the app. It only ever needed `createdBy`
 * and `teamId` to make the access decision, so the query is now scoped
 * accordingly.
 */

export interface FileAccessPrismaClient {
  file: {
    findUnique: (args: {
      where: { id: string };
      select: { createdBy: true; teamId: true };
    }) => Promise<{ createdBy: string; teamId: string } | null>;
  };
  teamMember: {
    findFirst: (args: {
      where: { teamId: string; userEmail: string };
    }) => Promise<{ role?: string } | null>;
  };
}

export async function hasFileAccess(
  prismaClient: FileAccessPrismaClient,
  fileId: string,
  email: string
): Promise<boolean> {
  if (!fileId || !email) return false;
  try {
    const file = await prismaClient.file.findUnique({
      where: { id: fileId },
      select: { createdBy: true, teamId: true },
    });
    if (!file) return false;
    if (file.createdBy === email) return true;

    const teamMember = await prismaClient.teamMember.findFirst({
      where: {
        teamId: file.teamId,
        userEmail: email,
      },
    });
    return !!teamMember;
  } catch (error) {
    console.error(`[WS AUTH CHECK ERROR] Failed to check access:`, error);
    return false;
  }
}
