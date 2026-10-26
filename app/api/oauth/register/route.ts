import { prisma } from '@/lib/db';
import { checkRateLimit, getClientIp, LIMITS } from '@/lib/rate-limiter';
import { isAllowedRedirectUri } from '@/lib/oauth/core';
import { registerClient } from '@/lib/oauth/store';

function err(error: string, description: string, status = 400): Response {
  return Response.json({ error, error_description: description }, { status, headers: { 'Cache-Control': 'no-store' } });
}

// RFC 7591 Dynamic Client Registration. Open by design (Claude registers on
// every fresh connection), so abuse is bounded by IP rate limiting, a strict
// redirect-URI allowlist, and the cleanup job that prunes unused clients.
export async function POST(request: Request): Promise<Response> {
  if (process.env.OAUTH_DISABLED === 'true') return err('temporarily_unavailable', 'OAuth is disabled', 503);
  const limit = await checkRateLimit(`oauth:register:${getClientIp(request)}`, LIMITS.OAUTH_REGISTER);
  if (!limit.allowed) return err('temporarily_unavailable', 'Too many registrations', 429);

  let body: { client_name?: unknown; redirect_uris?: unknown };
  try {
    body = await request.json();
  } catch {
    return err('invalid_client_metadata', 'Body must be JSON');
  }
  const uris = body.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.some((u) => typeof u !== 'string')) {
    return err('invalid_redirect_uri', 'redirect_uris must be a non-empty array of strings');
  }
  if (!(uris as string[]).every(isAllowedRedirectUri)) {
    return err('invalid_redirect_uri', 'Only the Claude callback and loopback redirect URIs are allowed');
  }
  const clientName = typeof body.client_name === 'string' ? body.client_name : 'MCP client';
  const client = await registerClient(prisma, { clientName, redirectUris: uris as string[] });
  return Response.json(
    {
      client_id: client.clientId,
      client_name: client.clientName,
      redirect_uris: client.redirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    },
    { status: 201, headers: { 'Cache-Control': 'no-store' } },
  );
}
