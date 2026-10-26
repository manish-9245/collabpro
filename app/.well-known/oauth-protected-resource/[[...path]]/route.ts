import { getBaseUrlInfo, metadataHeaders, SUPPORTED_SCOPES } from '@/lib/oauth/core';

// RFC 9728 protected-resource metadata. Claude requires `resource` to equal
// the MCP URL exactly as the user enters it. Served at the root path and at
// /.well-known/oauth-protected-resource/api/mcp (the path-suffixed form).
export function GET(request: Request): Response {
  if (process.env.OAUTH_DISABLED === 'true') return new Response('Not found', { status: 404 });
  const info = getBaseUrlInfo(request);
  const base = info.url;
  return Response.json(
    {
      resource: `${base}/api/mcp`,
      authorization_servers: [base],
      scopes_supported: SUPPORTED_SCOPES,
      bearer_methods_supported: ['header'],
      resource_name: 'CollabPro MCP',
    },
    { headers: metadataHeaders(info) },
  );
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' } });
}
