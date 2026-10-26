import { timingSafeEqual } from 'node:crypto';
import { prisma } from '@/lib/db';
import { cleanupExpired } from '@/lib/oauth/store';
import { checkRateLimit, getClientIp, LIMITS } from '@/lib/rate-limiter';
import { logger } from '@/lib/logger';

// A short secret is brute-forceable over HTTP, so anything under this length is treated as "not configured".
const MIN_SECRET_LENGTH = 24;

// Runs inside the app image (no extra tooling), so a Railway/cron job can just
//   curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/internal/oauth-cleanup
// Fails closed: with CRON_SECRET unset (or shorter than 24 characters) the endpoint is disabled (404);
// guesses are rate limited per source IP before the secret is compared.
export async function POST(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return new Response('Not found', { status: 404 });
  if (secret.length < MIN_SECRET_LENGTH) {
    // Same 404 as "unset" for callers, but tell the operator why their cron is failing.
    logger.warn('oauth_cleanup_disabled', { reason: `CRON_SECRET is set but shorter than ${MIN_SECRET_LENGTH} characters` });
    return new Response('Not found', { status: 404 });
  }
  const limit = await checkRateLimit(`oauth:cleanup:${getClientIp(request)}`, LIMITS.CRON);
  if (!limit.allowed) return new Response('Too many requests', { status: 429 });
  const presented = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
    return new Response('Unauthorized', { status: 401 });
  }
  return Response.json(await cleanupExpired(prisma), { headers: { 'Cache-Control': 'no-store' } });
}
