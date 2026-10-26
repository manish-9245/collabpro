import { prisma } from '@/lib/db';
import { checkRateLimit, getClientIp, LIMITS } from '@/lib/rate-limiter';
import { logAuditEvent } from '@/lib/audit';
import { revokeByToken } from '@/lib/oauth/store';
import { hasMediaType, NO_STORE_HEADERS, parseForm, readBodyCapped } from '@/lib/oauth/http';

// RFC 7009 token revocation. 200 for every well-formed request (400 malformed, 429/503 throttled/disabled), whether or
// not the token existed, so it cannot be used to test whether a token is valid.
export async function POST(request: Request): Promise<Response> {
  if (process.env.OAUTH_DISABLED === 'true') return new Response(null, { status: 503, headers: NO_STORE_HEADERS });
  const ip = getClientIp(request);
  const limit = await checkRateLimit(`oauth:token:${ip}`, LIMITS.OAUTH_TOKEN);
  if (!limit.allowed) return new Response(null, { status: 429, headers: NO_STORE_HEADERS });
  if (!hasMediaType(request, 'application/x-www-form-urlencoded')) {
    return Response.json({ error: 'invalid_request' }, { status: 400, headers: NO_STORE_HEADERS });
  }
  const text = await readBodyCapped(request);
  const form = text === null ? null : parseForm(text);
  const token = form?.get('token');
  const clientId = form?.get('client_id');
  if (!token || !clientId) return Response.json({ error: 'invalid_request' }, { status: 400, headers: NO_STORE_HEADERS });
  const revoked = await revokeByToken(prisma, clientId, token);
  if (revoked > 0) void logAuditEvent(null, 'unknown', 'oauth:token:revoked', { clientId, tokens: revoked }, ip);
  return new Response(null, { status: 200, headers: NO_STORE_HEADERS });
}
