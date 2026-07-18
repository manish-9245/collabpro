import { prisma } from '@/lib/db';
import { logAuditEvent } from '@/lib/audit';

export async function handleTeamService(path: string, args: any, authUserEmail: string | null, ipAddress: string): Promise<any> {
  let result: any = null;

  switch (path) {
    case 'teams:getTeam': {
      const { email } = args || {};
      const targetEmail = authUserEmail || email;
      if (!targetEmail) {
        throw new Error("Authentication required");
      }
      const createdTeams = await prisma.team.findMany({
        where: { createdBy: targetEmail },
        orderBy: { createdAt: 'desc' },
      });
      const memberships = await prisma.teamMember.findMany({
        where: { userEmail: targetEmail },
      });
      const memberTeamIds = memberships.map(m => m.teamId);
      const memberTeams = await prisma.team.findMany({
        where: { id: { in: memberTeamIds } },
        orderBy: { createdAt: 'desc' },
      });
      const allTeams = [...createdTeams, ...memberTeams];
      // Deduplicate by ID
      const uniqueTeams = allTeams.filter((t, index, self) =>
        self.findIndex(temp => temp.id === t.id) === index
      );
      result = uniqueTeams;
      break;
    }
    case 'teams:createTeam': {
      const { teamName, createdBy } = args || {};
      const targetCreatedBy = authUserEmail || createdBy;
      if (!targetCreatedBy) {
        throw new Error("Authentication required");
      }
      result = await prisma.team.create({
        data: { teamName, createdBy: targetCreatedBy },
      });
      break;
    }
    case 'teams:getTeamProfile': {
      const { teamId, requesterEmail } = args || {};
      const team = await prisma.team.findUnique({
        where: { id: teamId },
      });
      if (!team) {
        result = null;
        break;
      }
      // Privacy logic: if private, only allow members
      if (team.isPrivate && requesterEmail && team.createdBy !== requesterEmail) {
        const membership = await prisma.teamMember.findFirst({
          where: { teamId, userEmail: requesterEmail },
        });
        if (!membership) {
          result = {
            id: team.id,
            teamName: team.teamName,
            createdBy: team.createdBy,
            isPrivate: true,
            description: "This team profile is private to team members.",
            industry: "", website: "", github: ""
          };
          break;
        }
      }
      result = team;
      break;
    }
    case 'teams:updateTeamProfile': {
      const { teamId, description, industry, website, github, isPrivate } = args || {};
      result = await prisma.team.update({
        where: { id: teamId },
        data: { description, industry, website, github, isPrivate },
      });
      break;
    }
    case 'teams:deleteTeam': {
      const { teamId, ownerEmail } = args || {};
      const team = await prisma.team.findUnique({
        where: { id: teamId },
      });
      if (!team) {
        throw new Error("Team not found");
      }
      if (team.createdBy !== ownerEmail) {
        throw new Error("Only the team creator can delete the team.");
      }

      // 1. Fetch all files belonging to the team
      const files = await prisma.file.findMany({
        where: { teamId },
      });
      const fileIds = files.map(f => f.id);

      // 2. Cascade delete all file-dependent records
      if (fileIds.length > 0) {
        await prisma.fileVersion.deleteMany({
          where: { fileId: { in: fileIds } },
        });
        await prisma.filePresence.deleteMany({
          where: { fileId: { in: fileIds } },
        });
        await prisma.sharedLink.deleteMany({
          where: { fileId: { in: fileIds } },
        });
        await prisma.file.deleteMany({
          where: { id: { in: fileIds } },
        });
      }

      // 3. Delete team memberships
      await prisma.teamMember.deleteMany({
        where: { teamId },
      });

      // 4. Delete team invitations
      await prisma.invitation.deleteMany({
        where: { teamId },
      });

      // 5. Delete shared library items
      await prisma.sharedLibraryItem.deleteMany({
        where: { teamId },
      });

      // 6. Finally delete the team itself
      result = await prisma.team.delete({
        where: { id: teamId },
      });
      break;
    }
    case 'teams:leaveTeam': {
      const { teamId, userEmail } = args || {};
      const targetUserEmail = authUserEmail || userEmail;
      if (!targetUserEmail) {
        throw new Error("Authentication required");
      }
      // Owner cannot leave, they must delete or transfer (handled simply by verifying createdBy)
      const team = await prisma.team.findUnique({
        where: { id: teamId },
      });
      if (team?.createdBy === targetUserEmail) {
        throw new Error("As team creator, you cannot leave. You can manage or delete the team.");
      }
      result = await prisma.teamMember.deleteMany({
        where: { teamId, userEmail: targetUserEmail },
      });
      // Create notification for team owner
      await prisma.notification.create({
        data: {
          userEmail: team?.createdBy || "",
          title: "Member Left Team",
          message: `${targetUserEmail} has left team ${team?.teamName}.`,
          type: "response"
        }
      });
      break;
    }
    case 'teams:removeMember': {
      const { teamId, userEmail, ownerEmail } = args || {};
      const targetOwnerEmail = authUserEmail || ownerEmail;
      if (!targetOwnerEmail) {
        throw new Error("Authentication required");
      }
      const team = await prisma.team.findUnique({
        where: { id: teamId },
      });
      if (team?.createdBy !== targetOwnerEmail) {
        throw new Error("Only the team owner can remove members.");
      }
      result = await prisma.teamMember.deleteMany({
        where: { teamId, userEmail },
      });
      // Create notification for removed member
      await prisma.notification.create({
        data: {
          userEmail,
          title: "Removed from Team",
          message: `You have been removed from team ${team?.teamName} by the owner.`,
          type: "system"
        }
      });

      await logAuditEvent(
        teamId,
        targetOwnerEmail,
        "member:remove",
        { removedUserEmail: userEmail },
        ipAddress
      );

      break;
    }
    case 'teams:getTeamMembers': {
      if (args === 'skip' || !args) {
        result = [];
        break;
      }
      const { teamId } = args || {};
      if (!teamId) {
        result = [];
        break;
      }
      const team = await prisma.team.findUnique({
        where: { id: teamId },
      });
      if (!team) {
        result = [];
        break;
      }
      const members = await prisma.teamMember.findMany({
        where: { teamId },
      });
      const list = [
        { email: team.createdBy, role: 'owner' },
        ...members.map(m => ({ email: m.userEmail, role: m.role })),
      ];
      result = list.filter((m, index, self) =>
        self.findIndex(temp => temp.email === m.email) === index
      );
      break;
    }
    case 'teams:inviteMember': {
      const { teamId, userEmail, role } = args || {};
      const team = await prisma.team.findUnique({
        where: { id: teamId },
      });
      if (!team) {
        throw new Error("Team not found");
      }

      // Enforce that only the true owner can invite members
      if (authUserEmail && team.createdBy !== authUserEmail) {
        throw new Error("Only the team owner can invite members.");
      }

      // Check if already in team
      const existingMember = await prisma.teamMember.findFirst({
        where: { teamId, userEmail },
      });
      if (existingMember || team.createdBy === userEmail) {
        throw new Error("User is already a member of this team.");
      }

      // Fetch organization settings
      const orgSettings = await prisma.orgSetting.findUnique({
        where: { teamId },
      });

      // 1. Check Domain restrictions
      if (orgSettings && orgSettings.allowedDomains) {
        const allowed = orgSettings.allowedDomains.split(',').map(d => d.trim().toLowerCase()).filter(Boolean);
        if (allowed.length > 0) {
          const domain = userEmail.split('@')[1]?.toLowerCase();
          if (!domain || !allowed.includes(domain)) {
            throw new Error(`Invitation blocked: Email domain '${domain || 'unknown'}' is not authorized. Allowed domains: ${orgSettings.allowedDomains}`);
          }
        }
      }

      // 2. Check seat limit
      const activeSeats = (await prisma.teamMember.count({ where: { teamId } })) + 1;
      const limit = orgSettings ? orgSettings.seatLimit : 50;
      if (activeSeats >= limit) {
        throw new Error(`Seat limit reached: Your organization has reached its maximum seat capacity of ${limit} members.`);
      }

      // GitHub strategy: Create a pending invitation!
      const existingInvite = await prisma.invitation.findFirst({
        where: { teamId, inviteeEmail: userEmail, status: "pending" },
      });
      if (existingInvite) {
        throw new Error("An invitation is already pending for this user.");
      }

      const invite = await prisma.invitation.create({
        data: {
          teamId,
          teamName: team.teamName,
          inviterEmail: team.createdBy,
          inviteeEmail: userEmail,
          status: "pending",
        }
      });

      // Create notification for invitee
      await prisma.notification.create({
        data: {
          userEmail,
          title: "New Team Invitation",
          message: `You have been invited to join team "${team.teamName}" by ${team.createdBy}.`,
          type: "invite"
        }
      });

      await logAuditEvent(
        teamId,
        authUserEmail || "unknown@collabpro.com",
        "member:invite",
        { inviteeEmail: userEmail, role: role || "member" },
        ipAddress
      );

      result = invite;
      break;
    }
    default:
      throw new Error(`Path ${path} not supported in teamService`);
  }

  return result;
}
