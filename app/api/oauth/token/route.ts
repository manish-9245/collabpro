import { prisma } from '@/lib/db';
import { checkRateLimit, getClientIp, LIMITS } from '@/lib/rate-limiter';
import { logAuditEvent } from '@/lib/audit';
import { cleanupExpired, exchangeAuthCode, refreshTokens } from '@/lib/oauth/store';

const NO_STORE = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };

function fail(error: string, description: string, status = 400): Response {
  return Response.json({ error, error_description: description }, { status, headers: NO_STORE });
}

// OAuth 2.1 token endpoint. Spec requires application/x-www-form-urlencoded
// (Claude sends exactly that for both the code exchange and refreshes).
export async function POST(request: Request): Promise<Response> {
  if (process.env.OAUTH_DISABLED === 'true') return fail('temporarily_unavailable', 'OAuth is disabled', 503);
  const ip = getClientIp(request);
  const limit = await checkRateLimit(`oauth:token:${ip}`, LIMITS.OAUTH_TOKEN);
  if (!limit.allowed) return fail('temporarily_unavailable', 'Too many requests', 429);

  let form: URLSearchParams;
  try {
    form = new URLSearchParams(await request.text());
  } catch {
    return fail('invalid_request', 'Body must be form-encoded');
  }
  const grantType = form.get('grant_type');
  const clientId = form.get('client_id') ?? '';
  if (!clientId) return fail('invalid_request', 'client_id is required');

  let result;
  if (grantType === 'authorization_code') {
    const code = form.get('code');
    const redirectUri = form.get('redirect_uri');
    const verifier = form.get('code_verifier');
    if (!code || !redirectUri || !verifier) return fail('invalid_request', 'code, redirect_uri and code_verifier are required');
    result = await exchangeAuthCode(prisma, { code, clientId, redirectUri, codeVerifier: verifier });
  } else if (grantType === 'refresh_token') {
    const refreshToken = form.get('refresh_token');
    if (!refreshToken) return fail('invalid_request', 'refresh_token is required');
    result = await refreshTokens(prisma, { refreshToken, clientId });
  } else {
    return fail('unsupported_grant_type', 'Use authorization_code or refresh_token');
  }

  if ('error' in result) {
    void logAuditEvent(null, 'unknown', 'oauth:token:failure', { grantType, clientId, reason: result.description }, ip);
    return fail(result.error, result.description);
  }

  // Opportunistic housekeeping (about 1 in 50 successful exchanges); the
  // scripts/cleanup-oauth.ts job is the primary path.
  if (Math.random() < 0.02) void cleanupExpired(prisma).catch(() => {});

  return Response.json(
    { access_token: result.accessToken, token_type: 'Bearer', expires_in: result.expiresIn, refresh_token: result.refreshToken, scope: result.scope },
    { headers: NO_STORE },
  );
}
