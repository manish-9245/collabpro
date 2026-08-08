import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { prisma } from '@/lib/db';
import { verifyApiKey } from '@/lib/api-key-middleware';
import { registerCollabProTools } from '@/lib/mcp/tools';
import { registerCollabProPrompts } from '@/lib/mcp/prompts';
import { checkRateLimit, getClientIp, LIMITS } from '@/lib/rate-limiter';
import { logAuditEvent } from '@/lib/audit';
import { logger } from '@/lib/logger';

// Real request bodies here are Editor.js documents / Excalidraw element
// arrays, which can legitimately run to a few hundred KB - 5MB comfortably
// covers that while still bounding a malicious/broken client from streaming
// an unbounded body into memory.
const MAX_MCP_BODY_BYTES = 5 * 1024 * 1024;

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
  const ip = getClientIp(request);
  const authHeader = request.headers.get('Authorization');
  const authResult = await verifyApiKey(authHeader);

  if (!authResult.isValid || !authResult.userEmail) {
    // No email on a bad/missing key to log against - IP is the only signal.
    // Mirrors the auth:login:failure convention elsewhere in the app.
    void logAuditEvent(null, authResult.userEmail || 'unknown', 'mcp:auth:failure', { reason: authResult.error }, ip);
    return jsonRpcError(authResult.statusCode || 401, authResult.error || 'Unauthorized API Key', authResult.statusCode || 401);
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

  const server = new McpServer({ name: 'collabpro-mcp-server', version: '1.0.0' });
  registerCollabProTools(server, {
    prisma,
    userEmail: authResult.userEmail,
    scope: authResult.scope,
    ip,
  });
  registerCollabProPrompts(server);

  // Stateless mode (no sessionIdGenerator): each HTTP request is independent,
  // matching this route's existing behavior - no server-initiated
  // notifications or long-lived streams are needed for these tools, so
  // enableJsonResponse keeps every call a single request/response instead of
  // opening an SSE stream.
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  await server.connect(transport);
  const response = await transport.handleRequest(request, { parsedBody });

  const method = !parsedBody ? undefined : Array.isArray(parsedBody) ? 'batch' : (parsedBody as { method?: string }).method;
  const toolName = !parsedBody || Array.isArray(parsedBody)
    ? undefined
    : (parsedBody as { params?: { name?: string } }).params?.name;
  logger.info('mcp_request', {
    userEmail: authResult.userEmail,
    method,
    tool: toolName,
    status: response.status,
    durationMs: Date.now() - startedAt,
  });

  return response;
}
