import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { prisma } from '@/lib/db';
import { verifyApiKey, type ApiKeyVerificationResult } from '@/lib/api-key-middleware';
import { registerCollabProTools } from '@/lib/mcp/tools';
import { registerCollabProPrompts } from '@/lib/mcp/prompts';
import { checkRateLimit, getClientIp, LIMITS } from '@/lib/rate-limiter';
import { logAuditEvent } from '@/lib/audit';
import { logger } from '@/lib/logger';
import { getBaseUrl } from '@/lib/oauth/core';
import { readBodyCapped } from '@/lib/oauth/http';
import { generatorForTeam, hasAiProvider } from '@/lib/mcp/ai-spec';
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

/** JSON-RPC method and (for tools/call) tool name, without trusting the body's shape. */
function describeRequest(parsedBody: unknown): { method?: string; toolName?: string } {
  if (!parsedBody) return {};
  if (Array.isArray(parsedBody)) return { method: 'batch' };
  const body = parsedBody as { method?: string; params?: { name?: string } };
  return { method: body.method, toolName: body.params?.name };
}

/**
 * Builds the 401/403 for a failed authentication. A 401 carries
 * resource_metadata - that is what starts Claude's OAuth sign-in (it ignores
 * WWW-Authenticate on any other status).
 *
 * A request with NO credentials is just OAuth discovery (Claude probes
 * unauthenticated first), so it is never audited. A presented-but-bad
 * credential (often just an expired token) is audited through a per-IP slot
 * (1/min) AND a global slot, so neither one noisy IP nor many IPs together can
 * grow the AuditLog table without bound. Failures are never turned into 429s:
 * that would only add limiter round trips to a path that already cost a DB
 * lookup, and would strip the WWW-Authenticate header an expiring client needs.
 */
async function rejectUnauthenticated(
  request: Request,
  authResult: ApiKeyVerificationResult,
  authHeader: string | null,
  ip: string,
): Promise<Response> {
  if (authHeader) {
    const [perIp, global] = await Promise.all([
      checkRateLimit(`mcp:authfail-audit:${ip}`, LIMITS.MCP_AUTH_FAIL_AUDIT),
      checkRateLimit('mcp:authfail-audit:global', LIMITS.MCP_AUTH_FAIL_AUDIT_GLOBAL),
    ]);
    if (perIp.allowed && global.allowed) {
      void logAuditEvent(null, authResult.userEmail || 'unknown', 'mcp:auth:failure', { reason: authResult.error }, ip);
    }
  }
  const status = authResult.statusCode || 401;
  const headers = status === 401
    ? { 'WWW-Authenticate': `Bearer resource_metadata="${getBaseUrl(request)}/.well-known/oauth-protected-resource"${authHeader ? ', error="invalid_token"' : ''}` }
    : undefined;
  return jsonRpcError(status, authResult.error || 'Unauthorized API Key', status, headers);
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
    return rejectUnauthenticated(request, authResult, authHeader, ip);
  }
  const userEmail = authResult.userEmail;

  // Keyed per API key (or per OAuth grant family, which is stable across
  // refresh rotation so refreshing cannot multiply the allowance) rather than
  // per IP - legitimate agentic clients make tight bursts of calls from one
  // machine, so an IP-keyed limit would be too loose or too strict.
  const rateLimitKey = `mcp:${authResult.apiKeyId || userEmail}`;
  const rateLimit = await checkRateLimit(rateLimitKey, LIMITS.MCP);
  if (!rateLimit.allowed) {
    if (rateLimit.firstBlock) {
      void logAuditEvent(null, userEmail, 'mcp:rate_limited', {}, ip);
    }
    const retryAfterSeconds = Math.max(1, Math.ceil((rateLimit.resetAt - Date.now()) / 1000));
    return jsonRpcError(-32000, 'Rate limit exceeded', 429, { 'Retry-After': String(retryAfterSeconds) });
  }

  // Real byte cap enforced WHILE streaming (Content-Length is client-reported
  // and easily spoofed/omitted); an oversized body is cancelled mid-flight, not
  // buffered whole. The parsed result is handed to the transport via
  // `parsedBody` so it never re-reads the (now-consumed) stream itself.
  const bodyText = await readBodyCapped(request, MAX_MCP_BODY_BYTES);
  if (bodyText === null) {
    return jsonRpcError(-32600, `Request body exceeds ${MAX_MCP_BODY_BYTES}-byte limit or could not be read`, 413);
  }

  let parsedBody: unknown;
  try {
    parsedBody = bodyText.length === 0 ? undefined : JSON.parse(bodyText);
  } catch {
    return jsonRpcError(-32700, 'Parse error: Invalid JSON', 400);
  }

  const { method, toolName } = describeRequest(parsedBody);

  const server = new McpServer({ name: 'collabpro-mcp-server', version: '1.1.0' });
  applyToolKillSwitch(server);
  registerCollabProTools(server, {
    prisma,
    userEmail,
    scope: isMcpReadOnly() ? 'read-only' : authResult.scope,
    ip,
    oauthClientId: authResult.oauthClientId,
    baseUrl: getBaseUrl(request),
    // Advertised only when some team the user belongs to has configured a
    // provider (checked just for tools/list and the AI tool itself). WHICH
    // provider is used is decided per call, from the team the diagram goes
    // into - never from "any team the user happens to be in".
    aiAvailable: method === 'tools/list' || toolName === 'collabpro_create_diagram' ? await hasAiProvider(prisma, userEmail) : false,
    generatorForTeam: (teamId: string) => generatorForTeam(prisma, teamId),
  });
  registerCollabProPrompts(server);

  // Stateless mode (no sessionIdGenerator): each HTTP request is independent.
  // Plain JSON responses by default; only the long-running AI tool streams
  // (SSE) so it can send notifications/progress while the model works.
  const streams = method === 'tools/call' && !!toolName && STREAMING_TOOLS.has(toolName);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: !streams,
  });

  await server.connect(transport);
  const response = await transport.handleRequest(request, { parsedBody });

  logger.info('mcp_request', {
    userEmail,
    oauthClientId: authResult.oauthClientId,
    method,
    tool: toolName,
    status: response.status,
    durationMs: Date.now() - startedAt,
  });

  return response;
}
