import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { prisma } from '@/lib/db';
import { verifyApiKey } from '@/lib/api-key-middleware';
import { registerCollabProTools } from '@/lib/mcp/tools';

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
  const authHeader = request.headers.get('Authorization');
  const authResult = await verifyApiKey(authHeader);

  if (!authResult.isValid || !authResult.userEmail) {
    return Response.json({
      jsonrpc: '2.0',
      error: {
        code: authResult.statusCode || 401,
        message: authResult.error || 'Unauthorized API Key',
      },
      id: null,
    }, { status: authResult.statusCode || 401 });
  }

  const server = new McpServer({ name: 'collabpro-mcp-server', version: '1.0.0' });
  registerCollabProTools(server, {
    prisma,
    userEmail: authResult.userEmail,
    scope: authResult.scope,
  });

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
  return transport.handleRequest(request);
}
