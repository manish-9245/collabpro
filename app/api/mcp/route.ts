import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { prisma } from '@/lib/db';
import { verifyApiKey } from '@/lib/api-key-middleware';
import { registerCollabProTools } from '@/lib/mcp/tools';
import { registerCollabProPrompts } from '@/lib/mcp/prompts';
import { checkRateLimit, getClientIp, LIMITS } from '@/lib/rate-limiter';
import { logAuditEvent } from '@/lib/audit';
import { logger } from '@/lib/logger';
import { getBaseUrl } from '@/lib/oauth/core';
import { resolveSpecGenerator } from '@/lib/mcp/ai-spec';
import { applyToolKillSwitch, isMcpDisabled, isMcpReadOnly } from '@/lib/mcp/kill-switch';

// Real request bodies here are Editor.js documents / Excalidraw element
// arrays, which can legitimately run to a few hundred KB - 5MB comfortably
// covers that while still bounding a malicious/broken client from streaming
// an unbounded body into memory.
const MAX_MCP_BODY_BYTES = 5 * 1024 * 1024;

const STREAMING_TOOLS = new Set(['collabpro_create_diagram']);

function jsonRpcError(code: number, message: string, status: number, headers?: HeadersInit): Response {
  return Response.json({ jsonrpc: '2.0', error: { code, message }, id: null }, { status, headers });
}

/**
 * CollabPro's real, spec-compliant MCP server - a Streamable HTTP transport
 * (https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)
 * built on the official SDK. Any MCP client that supports a remote HTTP
 * server can point directly at this URL with a Bearer token - no local
 * process required. scripts/mcp-server.ts is a stdio bridge for clients
 * that only support local stdio servers; it forwards to this same endpoint
 * rather than re-implementing any of this.
 *
 * Auth happens here, outside the SDK, exactly like every other API-key-
 * gated route in this app - the SDK only owns JSON-RPC/transport mechanics
 * once a request is already known to belong to a specific, authorized user.
 */
export async function POST(request: Request): Promise<Response> {
  const startedAt = Date.now();
  if (isMcpDisabled()) return jsonRpcError(-32001, 'MCP is temporarily disabled', 503, { 'Retry-After': '300' });
  const ip = getClientIp(request);
  const authHeader = request.headers.get('Authorization');
  const authResult = await verifyApiKey(authHeader, undefined, { allowOAuth: true });

  if (!authResult.isValid || !authResult.userEmail) {
    // No email on a bad/missing key to log against - IP is the only signal.
    // Mirrors the auth:login:failure convention elsewhere in the app.
    void logAuditEvent(null, authResult.userEmail || 'unknown', 'mcp:auth:failure', { reason: authResult.error }, ip);
    const status = authResult.statusCode || 401;
    // A 401 carrying resource_metadata is what starts Claude's OAuth sign-in
    // (it ignores WWW-Authenticate on any other status).
    const headers = status === 401
      ? {
          'WWW-Authenticate': `Bearer resource_metadata="${getBaseUrl(request)}/.well-known/oauth-protected-resource"${authHeader ? ', error="invalid_token"' : ''}`,
        }
      : undefined;
    return jsonRpcError(status, authResult.error || 'Unauthorized API Key', status, headers);
  }

  // Keyed per API key (falling back to email for defense in depth if the
  // key id is ever missing) rather than per IP - legitimate agentic clients
  // make tight bursts of calls from one machine, so an IP-keyed limit would
  // either be too loose to matter or too strict for normal use.
  const rateLimitKey = `mcp:${authResult.apiKeyId || authResult.userEmail}`;
  const rateLimit = await checkRateLimit(rateLimitKey, LIMITS.MCP);
  if (!rateLimit.allowed) {
    if (rateLimit.firstBlock) {
      void logAuditEvent(null, authResult.userEmail, 'mcp:rate_limited', {}, ip);
    }
    const retryAfterSeconds = Math.max(1, Math.ceil((rateLimit.resetAt - Date.now()) / 1000));
    return jsonRpcError(-32000, 'Rate limit exceeded', 429, { 'Retry-After': String(retryAfterSeconds) });
  }

  // Enforce a real byte-size cap (Content-Length is client-reported and
  // easily spoofed/omitted) by reading the body once here, then handing the
  // already-parsed result to the transport via `parsedBody` so it never
  // re-reads the (now-consumed) stream itself.
  const bodyBuffer = await request.arrayBuffer();
  if (bodyBuffer.byteLength > MAX_MCP_BODY_BYTES) {
    return jsonRpcError(-32600, `Request body exceeds ${MAX_MCP_BODY_BYTES}-byte limit`, 413);
  }

  let parsedBody: unknown;
  try {
    parsedBody = bodyBuffer.byteLength === 0 ? undefined : JSON.parse(new TextDecoder().decode(bodyBuffer));
  } catch {
    return jsonRpcError(-32700, 'Parse error: Invalid JSON', 400);
  }

  const method = !parsedBody ? undefined : Array.isArray(parsedBody) ? 'batch' : (parsedBody as { method?: string }).method;
  const toolName = !parsedBody || Array.isArray(parsedBody)
    ? undefined
    : (parsedBody as { params?: { name?: string } }).params?.name;

  const server = new McpServer({ name: 'collabpro-mcp-server', version: '1.1.0' });
  applyToolKillSwitch(server);
  registerCollabProTools(server, {
    prisma,
    userEmail: authResult.userEmail,
    scope: isMcpReadOnly() ? 'read-only' : authResult.scope,
    ip,
    oauthClientId: authResult.oauthClientId,
    baseUrl: getBaseUrl(request),
    // Looked up only when it can matter: tools/list (to advertise the AI tool)
    // or the AI tool itself being called. Every other call skips the query.
    generateSpec: method === 'tools/list' || toolName === 'collabpro_create_diagram'
      ? await resolveSpecGenerator(prisma, authResult.userEmail)
      : undefined,
  });
  registerCollabProPrompts(server);

  // Stateless mode (no sessionIdGenerator): each HTTP request is independent.
  // Plain JSON responses by default; only the long-running AI tool streams
  // (SSE) so it can send notifications/progress while the model works.
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: !(method === 'tools/call' && toolName && STREAMING_TOOLS.has(toolName)),
  });

  await server.connect(transport);
  const response = await transport.handleRequest(request, { parsedBody });

  logger.info('mcp_request', {
    userEmail: authResult.userEmail,
    oauthClientId: authResult.oauthClientId,
    method,
    tool: toolName,
    status: response.status,
    durationMs: Date.now() - startedAt,
  });

  return response;
}
