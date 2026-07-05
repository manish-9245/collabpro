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
        const existing = await prisma.teamMember.findFirst({
          where: { teamId, userEmail },
        });
        if (existing) {
          result = existing;
          break;
        }
        result = await prisma.teamMember.create({
          data: {
            teamId,
            userEmail,
            role: role ?? 'member',
          },
        });
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
        
        result = files.map(file => {
          const creator = userMap.get(file.createdBy);
          return {
            ...file,
            creatorName: creator?.name || file.createdBy.split('@')[0],
            creatorImage: creator?.image || null
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
        const { fileName, teamId, createdBy, archive, document, whiteboard } = args || {};
        result = await prisma.file.create({
          data: {
            fileName,
            teamId,
            createdBy,
            archive: archive ?? false,
            document: document ?? '',
            whiteboard: whiteboard ?? '',
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
      case 'files:archiveFile': {
        const { _id, archive } = args || {};
        result = await prisma.file.update({
          where: { id: _id },
          data: { archive },
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
