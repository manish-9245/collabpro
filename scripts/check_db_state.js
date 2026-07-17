const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany();
  console.log('USERS IN DB:', users.map(u => ({ id: t = u.id, email: u.email, name: u.name })));
  const teams = await prisma.team.findMany();
  console.log('TEAMS IN DB:', teams.map(t => ({ id: t.id, name: t.teamName, createdBy: t.createdBy })));
}

main().catch(console.error).finally(() => prisma.$disconnect());
