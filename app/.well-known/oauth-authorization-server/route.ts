import { getBaseUrlInfo, metadataHeaders, SUPPORTED_SCOPES } from '@/lib/oauth/core';

// RFC 8414 authorization-server metadata. Claude's DCR client registers as a
// public client, hence token_endpoint_auth_methods_supported: ["none"].
export function GET(request: Request): Response {
  if (process.env.OAUTH_DISABLED === 'true') return new Response('Not found', { status: 404 });
  const info = getBaseUrlInfo(request);
  const base = info.url;
  return Response.json(
    {
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/api/oauth/token`,
      registration_endpoint: `${base}/api/oauth/register`,
      revocation_endpoint: `${base}/api/oauth/revoke`,
      authorization_response_iss_parameter_supported: true,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: SUPPORTED_SCOPES,
    },
    { headers: metadataHeaders(info) },
  );
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' } });
}
