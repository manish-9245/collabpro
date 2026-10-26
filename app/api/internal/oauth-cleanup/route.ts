import { timingSafeEqual } from 'node:crypto';
import { prisma } from '@/lib/db';
import { cleanupExpired } from '@/lib/oauth/store';

// Runs inside the app image (no extra tooling), so a Railway/cron job can just
//   curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/internal/oauth-cleanup
// Fails closed: with CRON_SECRET unset the endpoint is disabled (404).
export async function POST(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return new Response('Not found', { status: 404 });
  const presented = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
    return new Response('Unauthorized', { status: 401 });
  }
  return Response.json(await cleanupExpired(prisma), { headers: { 'Cache-Control': 'no-store' } });
}
