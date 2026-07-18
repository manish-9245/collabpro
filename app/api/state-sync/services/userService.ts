import { prisma } from '@/lib/db';

export async function handleUserService(path: string, args: any, authUserEmail: string | null, ipAddress: string): Promise<any> {
  let result: any = null;

  switch (path) {
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
      const isPostgres = process.env.DATABASE_URL?.startsWith("postgres") || process.env.DATABASE_URL?.startsWith("prisma+postgres");
      result = await prisma.user.findMany({
        where: {
          OR: [
            isPostgres 
              ? ({ email: { contains: query, mode: 'insensitive' } } as any)
              : { email: { contains: query } },
            isPostgres 
              ? ({ name: { contains: query, mode: 'insensitive' } } as any)
              : { name: { contains: query } },
          ],
        },
        take: 10,
      });
      break;
    }
    default:
      throw new Error(`Path ${path} not supported in userService`);
  }

  return result;
}
