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

export type MutationAuthStrategy =
  | { type: 'team'; teamId: string }
  | { type: 'existing'; targetId: string }
  | { type: 'none' };

/**
 * Decides which authorization check a WS `mutation` message needs before
 * dispatch. `files:createFile` must be checked first and independent of any
 * `_id`/`fileId` present in `args` - `executeMutation`'s create-file case
 * never reads those fields, only `args.teamId`. Checking `targetId` first
 * (as an earlier version of this logic did) let a caller attach an
 * `_id`/`fileId` for a file they legitimately have access to, pass the
 * existing-file check for THAT file, then fall through into creating a file
 * under a completely different, never-checked `args.teamId` (issue #234).
 */
export function resolveMutationAuthStrategy(path: string, args: any): MutationAuthStrategy {
  if (path === 'files:createFile' || path === 'ai:saveSettings' || path === 'ai:deleteSettings') {
    // Same reasoning as files:createFile above: these key on args.teamId,
    // not args._id/fileId, so they must be checked before the generic
    // targetId fallback below or a caller could attach an _id/fileId for a
    // file they legitimately have access to and ride that check into
    // touching a completely different, never-checked args.teamId. This is
    // team-membership only (any member) - executeMutation's own case does
    // the stricter owner-only check, same split as the HTTP path
    // (app/api/state-sync/route.ts's teamPaths vs aiSettingsService.ts).
    return { type: 'team', teamId: args?.teamId };
  }
  const targetId = args?._id || args?.fileId;
  if (targetId) {
    return { type: 'existing', targetId };
  }
  return { type: 'none' };
}

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
