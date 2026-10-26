import { prisma } from '@/lib/db';
import { checkRateLimit, getClientIp, LIMITS } from '@/lib/rate-limiter';
import { logAuditEvent } from '@/lib/audit';
import { exchangeAuthCode, refreshTokens, type IssuedTokens, type OAuthError } from '@/lib/oauth/store';
import { getBaseUrl, resourceMatches } from '@/lib/oauth/core';
import { hasMediaType, NO_STORE_HEADERS, parseForm, readBodyCapped } from '@/lib/oauth/http';

function fail(error: string, description: string, status = 400): Response {
  return Response.json({ error, error_description: description }, { status, headers: NO_STORE_HEADERS });
}

type Parsed = { form: URLSearchParams } | { response: Response };

async function parseTokenRequest(request: Request): Promise<Parsed> {
  if (!hasMediaType(request, 'application/x-www-form-urlencoded')) {
    return { response: fail('invalid_request', 'Content-Type must be application/x-www-form-urlencoded') };
  }
  const text = await readBodyCapped(request);
  if (text === null) return { response: fail('invalid_request', 'Request body too large or unreadable', 413) };
  const form = parseForm(text);
  if (!form) return { response: fail('invalid_request', 'Parameters must not be repeated') };
  if (!resourceMatches(form.get('resource'), getBaseUrl(request))) {
    return { response: fail('invalid_target', 'resource does not identify this server') };
  }
  return { form };
}

function runGrant(form: URLSearchParams, clientId: string): Promise<IssuedTokens | OAuthError> | Response {
  const grantType = form.get('grant_type');
  if (grantType === 'authorization_code') {
    const code = form.get('code');
    const redirectUri = form.get('redirect_uri');
    const verifier = form.get('code_verifier');
    if (!code || !redirectUri || !verifier) return fail('invalid_request', 'code, redirect_uri and code_verifier are required');
    return exchangeAuthCode(prisma, { code, clientId, redirectUri, codeVerifier: verifier });
  }
  if (grantType === 'refresh_token') {
    const refreshToken = form.get('refresh_token');
    if (!refreshToken) return fail('invalid_request', 'refresh_token is required');
    return refreshTokens(prisma, { refreshToken, clientId });
  }
  return fail('unsupported_grant_type', 'Use authorization_code or refresh_token');
}

// OAuth 2.1 token endpoint. Spec requires application/x-www-form-urlencoded
// (Claude sends exactly that for both the code exchange and refreshes).
// Housekeeping of expired rows lives in /api/internal/oauth-cleanup (cron),
// not on this hot path.
export async function POST(request: Request): Promise<Response> {
  if (process.env.OAUTH_DISABLED === 'true') return fail('temporarily_unavailable', 'OAuth is disabled', 503);
  const ip = getClientIp(request);
  const limit = await checkRateLimit(`oauth:token:${ip}`, LIMITS.OAUTH_TOKEN);
  if (!limit.allowed) return fail('temporarily_unavailable', 'Too many requests', 429);

  const parsed = await parseTokenRequest(request);
  if ('response' in parsed) return parsed.response;
  const clientId = parsed.form.get('client_id') ?? '';
  if (!clientId) return fail('invalid_request', 'client_id is required');

  const outcome = runGrant(parsed.form, clientId);
  if (outcome instanceof Response) return outcome;
  const result = await outcome;

  if ('error' in result) {
    void logAuditEvent(null, 'unknown', 'oauth:token:failure', { grantType: parsed.form.get('grant_type'), clientId, reason: result.description }, ip);
    return fail(result.error, result.description);
  }
  return Response.json(
    { access_token: result.accessToken, token_type: 'Bearer', expires_in: result.expiresIn, refresh_token: result.refreshToken, scope: result.scope },
    { headers: NO_STORE_HEADERS },
  );
}
