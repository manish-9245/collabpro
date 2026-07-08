import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

function mapConvexIds(obj: any): any {
  if (!obj) return obj;
  if (Array.isArray(obj)) {
    return obj.map(mapConvexIds);
  }
  if (typeof obj === 'object') {
    if (obj instanceof Date) return obj.toISOString();
    
    const newObj: any = {};
    for (const key of Object.getOwnPropertyNames(obj)) {
      newObj[key] = mapConvexIds(obj[key]);
    }
    for (const key in obj) {
      if (!(key in newObj)) {
        newObj[key] = mapConvexIds(obj[key]);
      }
    }
    if (obj.id !== undefined && obj._id === undefined) {
      newObj._id = obj.id;
    }
    return newObj;
  }
  return obj;
}

export async function POST(request: Request) {
  try {
    const { path, args } = await request.json();
    console.log("Convex Mock Request: path =", path, "args =", JSON.stringify(args || {}));

    if (!path) {
      return NextResponse.json({ error: 'Path parameter required' }, { status: 400 });
    }

    let result: any = null;

    switch (path) {
      // User Queries & Mutations
      case 'user:getUser': {
        const { email } = args || {};
        result = await prisma.user.findMany({
          where: { email },
        });
        break;
      }
      case 'user:createUser': {
        const { name, email, image } = args || {};
        // Use upsert to prevent errors on duplicate create
        result = await prisma.user.upsert({
          where: { email },
          update: { name, image },
          create: { name, email, image },
        });
        break;
      }
      case 'user:updateUserImage': {
        const { _id, image } = args || {};
        result = await prisma.user.update({
          where: { id: _id },
          data: { image },
        });
        break;
      }
      case 'user:updateUserProfile': {
        const { email, title, description, github, twitter, linkedin, portfolio, isPrivate } = args || {};
        result = await prisma.user.update({
          where: { email },
          data: { title, description, github, twitter, linkedin, portfolio, isPrivate },
        });
        break;
      }
      case 'user:getUserProfile': {
        const { email, requesterEmail } = args || {};
        const profile = await prisma.user.findUnique({
          where: { email },
        });
        if (!profile) {
          result = null;
          break;
        }
        // Privacy logic: if private, only allow people who share at least one team with this user
        if (profile.isPrivate && requesterEmail && requesterEmail !== email) {
          const requesterTeams = await prisma.teamMember.findMany({
            where: { userEmail: requesterEmail },
          });
          const requesterCreatedTeams = await prisma.team.findMany({
            where: { createdBy: requesterEmail },
          });
          const requesterTeamIds = [...requesterTeams.map(t => t.teamId), ...requesterCreatedTeams.map(t => t.id)];

          const userTeams = await prisma.teamMember.findMany({
            where: { userEmail: email },
          });
          const userCreatedTeams = await prisma.team.findMany({
            where: { createdBy: email },
          });
          const userTeamIds = [...userTeams.map(t => t.teamId), ...userCreatedTeams.map(t => t.id)];

          const shared = requesterTeamIds.some(id => userTeamIds.includes(id));
          if (!shared) {
            // Scrub private details
            result = {
              id: profile.id,
              email: profile.email,
              name: profile.name,
              image: profile.image,
              isPrivate: true,
              title: "Private Profile",
              description: "This profile is private to organization & team members.",
              github: "", twitter: "", linkedin: "", portfolio: ""
            };
            break;
          }
        }
        result = profile;
        break;
      }
      case 'user:searchUsers': {
        const { query } = args || {};
        result = await prisma.user.findMany({
          where: {
            OR: [
              { email: { contains: query, mode: 'insensitive' } },
              { name: { contains: query, mode: 'insensitive' } },
            ],
          },
          take: 10,
        });
        break;
      }

      // Teams Queries & Mutations
      case 'teams:getTeam': {
        const { email } = args || {};
        const createdTeams = await prisma.team.findMany({
          where: { createdBy: email },
          orderBy: { createdAt: 'desc' },
        });
        const memberships = await prisma.teamMember.findMany({
          where: { userEmail: email },
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
        result = await prisma.team.create({
          data: { teamName, createdBy },
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
      case 'teams:leaveTeam': {
        const { teamId, userEmail } = args || {};
        // Owner cannot leave, they must delete or transfer (handled simply by verifying createdBy)
        const team = await prisma.team.findUnique({
          where: { id: teamId },
        });
        if (team?.createdBy === userEmail) {
          throw new Error("As team creator, you cannot leave. You can manage or delete the team.");
        }
        result = await prisma.teamMember.deleteMany({
          where: { teamId, userEmail },
        });
        // Create notification for team owner
        await prisma.notification.create({
          data: {
            userEmail: team?.createdBy || "",
            title: "Member Left Team",
            message: `${userEmail} has left team ${team?.teamName}.`,
            type: "response"
          }
        });
        break;
      }
      case 'teams:removeMember': {
        const { teamId, userEmail, ownerEmail } = args || {};
        const team = await prisma.team.findUnique({
          where: { id: teamId },
        });
        if (team?.createdBy !== ownerEmail) {
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
        // Check if already in team
        const existingMember = await prisma.teamMember.findFirst({
          where: { teamId, userEmail },
        });
        if (existingMember || team.createdBy === userEmail) {
          throw new Error("User is already a member of this team.");
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

        result = invite;
        break;
      }


      // Files Queries & Mutations
      case 'files:getFiles': {
        const { teamId, userEmail, scope } = args || {};
        let files = [];
        
        if (scope === 'org' && userEmail) {
          // Get all teams the user is member or creator of
          const createdTeams = await prisma.team.findMany({
            where: { createdBy: userEmail },
          });
          const memberships = await prisma.teamMember.findMany({
            where: { userEmail },
          });
          const memberTeamIds = memberships.map(m => m.teamId);
          const allTeamIds = [...createdTeams.map(t => t.id), ...memberTeamIds];
          
          files = await prisma.file.findMany({
            where: { teamId: { in: allTeamIds } },
            orderBy: { createdAt: 'desc' },
          });
        } else if (scope === 'personal' && userEmail) {
          files = await prisma.file.findMany({
            where: { teamId, createdBy: userEmail },
            orderBy: { createdAt: 'desc' },
          });
        } else {
          // Default: team scope
          files = await prisma.file.findMany({
            where: { teamId },
            orderBy: { createdAt: 'desc' },
          });
        }

        // Fetch user profiles for all file creators to attach real avatar and name
        const creatorEmails = Array.from(new Set(files.map(f => f.createdBy)));
        const users = await prisma.user.findMany({
          where: { email: { in: creatorEmails } },
        });
        
        const userMap = new Map(users.map(u => [u.email, u]));

        // Fetch team details to map teamId to teamName
        const teamIds = Array.from(new Set(files.map(f => f.teamId)));
        const teams = await prisma.team.findMany({
          where: { id: { in: teamIds } },
        });
        const teamMap = new Map(teams.map(t => [t.id, t]));
        
        result = files.map(file => {
          const creator = userMap.get(file.createdBy);
          const team = teamMap.get(file.teamId);
          return {
            ...file,
            creatorName: creator?.name || file.createdBy.split('@')[0],
            creatorImage: creator?.image || null,
            teamName: team?.teamName || null
          };
        });
        break;
      }
      case 'files:getFileById': {
        const { _id } = args || {};
        result = await prisma.file.findUnique({
          where: { id: _id },
        });
        break;
      }
      case 'files:createFile': {
        const { fileName, teamId, createdBy, archive, document, whiteboard, folder } = args || {};
        result = await prisma.file.create({
          data: {
            fileName,
            teamId,
            createdBy,
            archive: archive ?? false,
            document: document ?? '',
            whiteboard: whiteboard ?? '',
            folder: folder ?? null,
          },
        });
        break;
      }
      case 'files:updateDocument': {
        const { _id, document } = args || {};
        result = await prisma.file.update({
          where: { id: _id },
          data: { document },
        });
        break;
      }
      case 'files:updateWhiteboard': {
        const { _id, whiteboard } = args || {};
        result = await prisma.file.update({
          where: { id: _id },
          data: { whiteboard },
        });
        break;
      }
      case 'files:updateFileName': {
        const { _id, fileName } = args || {};
        result = await prisma.file.update({
          where: { id: _id },
          data: { fileName },
        });
        break;
      }
      case 'files:updateFileFolder': {
        const { _id, folder } = args || {};
        result = await prisma.file.update({
          where: { id: _id },
          data: { folder: folder || null },
        });
        break;
      }
      case 'files:archiveFile': {
        const { _id, archive } = args || {};
        result = await prisma.file.update({
          where: { id: _id },
          data: { archive },
        });
        break;
      }
      case 'files:deleteFile': {
        const { _id } = args || {};
        // Delete all file versions first
        await prisma.fileVersion.deleteMany({
          where: { fileId: _id },
        });
        await prisma.filePresence.deleteMany({
          where: { fileId: _id },
        });
        // Delete the file
        result = await prisma.file.delete({
          where: { id: _id },
        });
        break;
      }
      case 'files:createVersion': {
        const { fileId, createdByName, createdByImage, note } = args || {};
        const file = await prisma.file.findUnique({
          where: { id: fileId },
        });
        if (!file) {
          throw new Error("File not found");
        }
        
        // Find highest version
        const versions = await prisma.fileVersion.findMany({
          where: { fileId },
          orderBy: { version: 'desc' },
          take: 1,
        });
        const nextVer = versions.length > 0 ? versions[0].version + 1 : 1;

        result = await prisma.fileVersion.create({
          data: {
            fileId,
            document: file.document,
            whiteboard: file.whiteboard,
            version: nextVer,
            createdByName: createdByName || "Author",
            createdByImage: createdByImage || "",
            note: note || "",
          },
        });
        break;
      }
      case 'files:getVersions': {
        const { fileId } = args || {};
        result = await prisma.fileVersion.findMany({
          where: { fileId },
          orderBy: { createdAt: 'desc' },
        });
        break;
      }
      case 'files:restoreVersion': {
        const { versionId } = args || {};
        const version = await prisma.fileVersion.findUnique({
          where: { id: versionId },
        });
        if (!version) {
          throw new Error("Version not found");
        }
        
        // Update active file with version state
        result = await prisma.file.update({
          where: { id: version.fileId },
          data: {
            document: version.document,
            whiteboard: version.whiteboard,
          },
        });
        break;
      }
      case 'files:updateVersionNote': {
        const { versionId, note } = args || {};
        result = await prisma.fileVersion.update({
          where: { id: versionId },
          data: { note },
        });
        break;
      }
      case 'sharedLibrary:getItems': {
        const { teamId } = args || {};
        if (!teamId) {
          result = [];
          break;
        }
        result = await prisma.sharedLibraryItem.findMany({
          where: { teamId },
          orderBy: { updatedAt: 'desc' },
        });
        break;
      }
      case 'sharedLibrary:upsertItem': {
        const { id, teamId, name, description, sourceUrl, author, payload } = args || {};
        if (!teamId) {
          throw new Error("teamId is required.");
        }
        if (!name || typeof name !== "string") {
          throw new Error("name is required.");
        }
        if (!payload || typeof payload !== "string") {
          throw new Error("payload is required.");
        }

        const normalizedName = name.trim();
        if (!normalizedName) {
          throw new Error("name is required.");
        }

        let existing = null;
        if (id) {
          existing = await prisma.sharedLibraryItem.findFirst({
            where: { id, teamId },
          });
        }
        if (!existing) {
          existing = await prisma.sharedLibraryItem.findFirst({
            where: { teamId, name: normalizedName },
          });
        }

        if (existing) {
          result = await prisma.sharedLibraryItem.update({
            where: { id: existing.id },
            data: {
              name: normalizedName,
              description: description || "",
              sourceUrl: sourceUrl || "",
              author: author || "",
              payload,
            },
          });
        } else {
          result = await prisma.sharedLibraryItem.create({
            data: {
              teamId,
              name: normalizedName,
              description: description || "",
              sourceUrl: sourceUrl || "",
              author: author || "",
              payload,
            },
          });
        }
        break;
      }
      case 'files:upsertPresence': {
        const { fileId, userEmail, userName, userImage, userColor, workspaceStatus } = args || {};
        if (!fileId || !userEmail) {
          throw new Error("fileId and userEmail are required for presence updates");
        }
        result = await prisma.filePresence.upsert({
          where: {
            fileId_userEmail: {
              fileId,
              userEmail,
            },
          },
          create: {
            fileId,
            userEmail,
            userName: userName || userEmail.split('@')[0] || "Collaborator",
            userImage: userImage || "",
            userColor: userColor || "#6366f1",
            workspaceStatus: workspaceStatus || "Viewing workspace",
          },
          update: {
            userName: userName || userEmail.split('@')[0] || "Collaborator",
            userImage: userImage || "",
            userColor: userColor || "#6366f1",
            workspaceStatus: workspaceStatus || "Viewing workspace",
            lastSeenAt: new Date(),
          },
        });
        break;
      }
      case 'files:clearPresence': {
        const { fileId, userEmail } = args || {};
        if (!fileId || !userEmail) {
          result = { success: false };
          break;
        }
        result = await prisma.filePresence.deleteMany({
          where: { fileId, userEmail },
        });
        break;
      }
      case 'files:getActiveCollaborators': {
        const { fileId, currentUserEmail } = args || {};
        if (!fileId) {
          result = [];
          break;
        }
        const activeSince = new Date(Date.now() - 15_000);
        result = await prisma.filePresence.findMany({
          where: {
            fileId,
            lastSeenAt: { gte: activeSince },
            ...(currentUserEmail ? { userEmail: { not: currentUserEmail } } : {}),
          },
          orderBy: { lastSeenAt: 'desc' },
        });
        break;
      }
      case 'notifications:getNotifications': {
        const { userEmail } = args || {};
        result = await prisma.notification.findMany({
          where: { userEmail },
          orderBy: { createdAt: 'desc' },
        });
        break;
      }
      case 'notifications:markRead': {
        const { userEmail, notificationId } = args || {};
        if (notificationId) {
          result = await prisma.notification.update({
            where: { id: notificationId },
            data: { read: true },
          });
        } else {
          result = await prisma.notification.updateMany({
            where: { userEmail },
            data: { read: true },
          });
        }
        break;
      }
      case 'notifications:getInvitations': {
        const { userEmail } = args || {};
        result = await prisma.invitation.findMany({
          where: { inviteeEmail: userEmail, status: "pending" },
          orderBy: { createdAt: 'desc' },
        });
        break;
      }
      case 'notifications:respondToInvitation': {
        const { invitationId, response } = args || {}; // response: "accept" or "decline"
        const invite = await prisma.invitation.findUnique({
          where: { id: invitationId },
        });
        if (!invite) {
          throw new Error("Invitation not found");
        }

        const newStatus = response === 'accept' ? 'accepted' : 'declined';
        await prisma.invitation.update({
          where: { id: invitationId },
          data: { status: newStatus },
        });

        if (response === 'accept') {
          // Add as team member
          await prisma.teamMember.create({
            data: {
              teamId: invite.teamId,
              userEmail: invite.inviteeEmail,
              role: 'member',
            }
          });

          // Create acceptance notification for inviter
          await prisma.notification.create({
            data: {
              userEmail: invite.inviterEmail,
              title: "Invitation Accepted",
              message: `${invite.inviteeEmail} accepted your invitation to join team "${invite.teamName}"!`,
              type: "response"
            }
          });
        } else {
          // Create decline notification for inviter
          await prisma.notification.create({
            data: {
              userEmail: invite.inviterEmail,
              title: "Invitation Declined",
              message: `${invite.inviteeEmail} declined your invitation to join team "${invite.teamName}".`,
              type: "response"
            }
          });
        }

        result = { success: true, status: newStatus };
        break;
      }



      default:
        console.error(`Convex Mock Error: Method ${path} not implemented`);
        return NextResponse.json({ error: `Method ${path} not implemented` }, { status: 404 });
    }

    const mappedResult = mapConvexIds(result);
    console.log("Mapped output payload:", JSON.stringify(mappedResult));
    return NextResponse.json({ data: mappedResult });
  } catch (error: any) {
    console.error('Convex mock API Error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
