/**
 * Team-membership authorization gate, shared by the WebSocket gateway
 * (`ws-server/server.ts`, for `files:createFile` mutations that have no
 * existing row to key an auth check off of) and the HTTP path
 * (`app/api/state-sync/route.ts`'s `teamPaths` gate). Previously duplicated
 * independently in both places (issue #234) — a future change to one copy
 * (e.g. a role check, or changed precedence between creator and member) could
 * silently drift from the other and break parity between the two
 * authorization paths.
 */

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
    console.error(`[AUTH CHECK ERROR] Failed to check team access:`, error);
    return false;
  }
}
