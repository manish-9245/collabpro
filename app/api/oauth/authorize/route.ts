import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from '@/lib/session-auth/server';
import { logAuditEvent } from '@/lib/audit';
import { getClientIp } from '@/lib/rate-limiter';
import { logger } from '@/lib/logger';
import { buildRedirect, getBaseUrl, normalizeScope, SCOPE_WRITE, verifyConsentToken } from '@/lib/oauth/core';
import { isSameOrigin } from '@/lib/oauth/http';
import { validateAuthorizeRequest } from '@/lib/oauth/authorize-request';
import { issueAuthCode } from '@/lib/oauth/store';

function plain(message: string, status: number): Response {
  return new Response(message, { status, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

// Consent submit. Defenses, in order: OAuth enabled -> same-origin POST ->
// signed-in user -> stateless HMAC consent token (CSRF, binds every field) ->
// re-validation of client/redirect/PKCE. Scope can only be narrowed here.
export async function POST(request: Request): Promise<Response> {
  if (process.env.OAUTH_DISABLED === 'true') return plain('OAuth is disabled', 503);

  if (!isSameOrigin(request)) return plain('Cross-origin request rejected', 403);
  const base = getBaseUrl(request);

  const user = await getServerSession().getUser();
  if (!user?.email) return plain('Not signed in', 401);

  const form = await request.formData();
  const field = (k: string) => (typeof form.get(k) === 'string' ? (form.get(k) as string) : '');

  const requestedScope = normalizeScope(field('scope'));
  const fields = {
    userEmail: user.email,
    clientId: field('client_id'),
    redirectUri: field('redirect_uri'),
    codeChallenge: field('code_challenge'),
    state: field('state'),
    scope: requestedScope,
  };
  if (!verifyConsentToken(field('consent_token'), fields)) return plain('Invalid or expired consent form', 403);

  const req = await validateAuthorizeRequest(prisma, {
    response_type: 'code',
    client_id: fields.clientId,
    redirect_uri: fields.redirectUri,
    code_challenge: fields.codeChallenge,
    code_challenge_method: 'S256',
    state: fields.state,
    scope: requestedScope,
  }, base);
  if ('error' in req) return plain(req.error, 400);

  const ip = getClientIp(request);
  if (field('decision') !== 'allow') {
    void logAuditEvent(null, user.email, 'oauth:consent:denied', { clientId: req.clientId }, ip);
    return NextResponse.redirect(buildRedirect(req.redirectUri, { error: 'access_denied', state: req.state || undefined, iss: base }), 303);
  }

  // Write is opt-in: only granted when the app asked for it AND the box was ticked.
  const grantedScope = requestedScope
    .split(' ')
    .filter((s) => s !== SCOPE_WRITE || field('allow_write') === '1')
    .join(' ');

  let code: string;
  try {
    code = await issueAuthCode(prisma, {
      clientId: req.clientId,
      userEmail: user.email,
      codeChallenge: req.codeChallenge,
      redirectUri: req.redirectUri,
      scope: grantedScope,
    });
  } catch (err) {
    // Only the one expected failure is recoverable: Prisma P2003 (foreign key) means the unused client
    // was pruned (after 24 h) between validation above and this insert. Anything else (outage, bug) must
    // stay a 5xx so it is observable and not misreported to the user as an expired request.
    if ((err as { code?: unknown } | null)?.code !== 'P2003') throw err;
    logger.warn('oauth_issue_code_failed', { clientId: req.clientId, reason: err instanceof Error ? err.message : String(err) });
    return plain('This connection request expired. Remove the connector in your AI app and add it again.', 409);
  }
  void logAuditEvent(null, user.email, 'oauth:consent:granted', { clientId: req.clientId, scope: grantedScope }, ip);
  return NextResponse.redirect(buildRedirect(req.redirectUri, { code, state: req.state || undefined, iss: base }), 303);
}
