import { prisma } from '@/lib/db';
import { checkRateLimit, getClientIp, LIMITS } from '@/lib/rate-limiter';
import { revokeByToken } from '@/lib/oauth/store';
import { NO_STORE_HEADERS, parseForm, readBodyCapped } from '@/lib/oauth/http';

// RFC 7009 token revocation. Always 200 for a well-formed request, whether or
// not the token existed, so it cannot be used to test whether a token is valid.
export async function POST(request: Request): Promise<Response> {
  if (process.env.OAUTH_DISABLED === 'true') return new Response(null, { status: 503, headers: NO_STORE_HEADERS });
  const limit = await checkRateLimit(`oauth:token:${getClientIp(request)}`, LIMITS.OAUTH_TOKEN);
  if (!limit.allowed) return new Response(null, { status: 429, headers: NO_STORE_HEADERS });
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/x-www-form-urlencoded')) {
    return Response.json({ error: 'invalid_request' }, { status: 400, headers: NO_STORE_HEADERS });
  }
  const text = await readBodyCapped(request);
  const form = text === null ? null : parseForm(text);
  const token = form?.get('token');
  const clientId = form?.get('client_id');
  if (!token || !clientId) return Response.json({ error: 'invalid_request' }, { status: 400, headers: NO_STORE_HEADERS });
  await revokeByToken(prisma, clientId, token);
  return new Response(null, { status: 200, headers: NO_STORE_HEADERS });
}
