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
        const { teamId } = args || {};
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
        const { teamId } = args || {};
        result = await prisma.file.findMany({
          where: { teamId },
          orderBy: { createdAt: 'desc' },
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
