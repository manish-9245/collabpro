import { prisma } from '@/lib/db';
import { checkRateLimit, getClientIp, LIMITS } from '@/lib/rate-limiter';
import { isAllowedRedirectUri } from '@/lib/oauth/core';
import { registerClient } from '@/lib/oauth/store';
import { NO_STORE_HEADERS, readBodyCapped } from '@/lib/oauth/http';

function err(error: string, description: string, status = 400): Response {
  return Response.json({ error, error_description: description }, { status, headers: NO_STORE_HEADERS });
}

// RFC 7591 Dynamic Client Registration. Open by design (Claude registers on
// every fresh connection), so abuse is bounded by IP rate limiting, a strict
// redirect-URI allowlist, and the cleanup job that prunes unused clients.
export async function POST(request: Request): Promise<Response> {
  if (process.env.OAUTH_DISABLED === 'true') return err('temporarily_unavailable', 'OAuth is disabled', 503);
  const limit = await checkRateLimit(`oauth:register:${getClientIp(request)}`, LIMITS.OAUTH_REGISTER);
  if (!limit.allowed) return err('temporarily_unavailable', 'Too many registrations', 429);

  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return err('invalid_client_metadata', 'Content-Type must be application/json');
  }
  let body: { client_name?: unknown; redirect_uris?: unknown };
  try {
    const text = await readBodyCapped(request);
    if (text === null) return err('invalid_client_metadata', 'Request body too large', 413);
    body = JSON.parse(text);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('not an object');
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
  const client = await registerClient(prisma, { clientName: typeof body.client_name === 'string' ? body.client_name : '', redirectUris: uris as string[] });
  if (!client) return err('temporarily_unavailable', 'Client registration is full; try again later', 503);
  return Response.json(
    {
      client_id: client.clientId,
      client_name: client.clientName,
      redirect_uris: client.redirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    },
    { status: 201, headers: NO_STORE_HEADERS },
  );
}
