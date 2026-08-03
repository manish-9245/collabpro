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

import type { SessionTokenPayload } from '../lib/session-auth/jwt';

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

/**
 * Resolves a WS handshake `?token=` query value to an authenticated user, or
 * null. Only a signature-verified token may identify a user — a value that
 * fails verification (bad signature, malformed, expired) must be treated
 * exactly like "no token", never parsed as a trusted fallback. Returning an
 * unverified `JSON.parse` of the raw value here previously let anyone
 * connect with `?token=<url-encoded JSON>` and be treated as whichever user
 * they claimed to be (issue #234).
 */
export function resolveTokenUser(
  tokenQuery: string,
  verifyTokenFn: (token: string) => SessionTokenPayload | null
): SessionTokenPayload | null {
  try {
    const decoded = decodeURIComponent(tokenQuery);
    return verifyTokenFn(decoded) ?? null;
  } catch {
    return null;
  }
}

export interface TeamAccessPrismaClient {
  team: {
    findUnique: (args: {
      where: { id: string };
      select: { createdBy: true };
    }) => Promise<{ createdBy: string } | null>;
  };
  teamMember: {
    findFirst: (args: {
      where: { teamId: string; userEmail: string };
      select: { userEmail: true };
    }) => Promise<{ userEmail?: string } | null>;
  };
}

/**
 * Team-membership check for WS mutations that create a new resource (no
 * existing file/row to key authorization off of yet — see `files:createFile`
 * in server.ts, issue #234). Mirrors `checkTeamAccess` in
 * `app/api/state-sync/route.ts`, the HTTP path's equivalent gate.
 */
export async function checkTeamAccess(
  prismaClient: TeamAccessPrismaClient,
  teamId: string,
  email: string
): Promise<boolean> {
  if (!teamId || !email) return false;
  try {
    const team = await prismaClient.team.findUnique({
      where: { id: teamId },
      select: { createdBy: true },
    });
    if (!team) return false;
    if (team.createdBy === email) return true;

    const teamMember = await prismaClient.teamMember.findFirst({
      where: { teamId, userEmail: email },
      select: { userEmail: true },
    });
    return !!teamMember;
  } catch (error) {
    console.error(`[WS AUTH CHECK ERROR] Failed to check team access:`, error);
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
