import { prisma } from '../lib/db';
import { cleanupExpired } from '../lib/oauth/store';

/**
 * Deletes OAuth rows nothing can use anymore (expired codes/tokens, revoked
 * tokens older than a week, abandoned dynamic client registrations). Safe to
 * run repeatedly; schedule daily, e.g. a Railway cron: `npm run oauth:cleanup`.
 */
cleanupExpired(prisma)
  .then((res) => {
    console.log(JSON.stringify({ event: 'oauth_cleanup', ...res }));
  })
  .catch((err) => {
    console.error('oauth_cleanup failed', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
