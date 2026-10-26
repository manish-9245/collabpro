import { prisma } from '../lib/db';
import { cleanupExpired } from '../lib/oauth/store';

/**
 * Deletes OAuth rows nothing can use anymore (expired codes/tokens, revoked
 * tokens older than a week, abandoned dynamic client registrations). Safe to
 * run repeatedly. This script needs a source checkout and `tsx` (not in the production image);
 * in production, call POST /api/internal/oauth-cleanup from a daily cron instead (see docs/runbooks/mcp.md).
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
