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
      select: { userEmail: true };
    }) => Promise<{ userEmail?: string } | null>;
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

    // Only existence matters here — select the narrowest possible field
    // rather than fetching the whole row (issue found in review, Group 5).
    const teamMember = await prismaClient.teamMember.findFirst({
      where: {
        teamId: file.teamId,
        userEmail: email,
      },
      select: { userEmail: true },
    });
    return !!teamMember;
  } catch (error) {
    console.error(`[WS AUTH CHECK ERROR] Failed to check access:`, error);
    return false;
  }
}

export interface MutationAuthPrismaClient {
  file: {
    findUnique: (args: {
      where: { id: string };
      select: { createdBy: true; teamId: true };
    }) => Promise<{ createdBy: string; teamId: string } | null>;
  };
  teamMember: {
    findFirst: (args: {
      where: { teamId: string; userEmail: string };
      select: { role: true };
    }) => Promise<{ role?: string } | null>;
  };
}

/**
 * Authorization check for WS mutations (issue found in review, Group 5 #1).
 *
 * Deliberately does NOT consult `FileAccessCache` — that cache exists to
 * spare the highest-frequency, lowest-stakes message type (cursor moves)
 * from hitting the DB, with a TTL window that's an acceptable staleness
 * trade-off there. A *mutation* (an actual write) must not tolerate that
 * same staleness: a team member who was just removed should be denied on
 * their very next write attempt, not after up to `FileAccessCache`'s TTL has
 * elapsed. This always re-reads from the database.
 */
export async function checkMutationAuth(
  prismaClient: MutationAuthPrismaClient,
  fileId: string,
  email: string
): Promise<{ allowed: boolean; error?: string }> {
  try {
    const file = await prismaClient.file.findUnique({
      where: { id: fileId },
      select: { createdBy: true, teamId: true },
    });
    if (!file) return { allowed: false, error: 'File not found' };

    if (file.createdBy === email) return { allowed: true };

    const teamMember = await prismaClient.teamMember.findFirst({
      where: { teamId: file.teamId, userEmail: email },
      select: { role: true },
    });

    if (!teamMember) {
      return { allowed: false, error: 'Forbidden: You do not have access to this file' };
    }
    if (teamMember.role === 'viewer') {
      return { allowed: false, error: 'Forbidden: Viewers cannot modify files' };
    }
    return { allowed: true };
  } catch (error) {
    console.error(`[WS MUTATION AUTH ERROR] Failed to check mutation auth:`, error);
    return { allowed: false, error: 'Internal auth check error' };
  }
}
