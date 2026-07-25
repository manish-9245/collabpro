import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST as mcpPOST } from '@/app/api/mcp/route';
import { verifyApiKey } from '@/lib/api-key-middleware';

// Mock database prisma
const mockFindMany = vi.fn();
const mockFindUnique = vi.fn();
const mockUpdate = vi.fn();
const mockUpdateMany = vi.fn();

vi.mock('@/lib/db', () => ({
  prisma: {
    teamMember: {
      findMany: (...args: any[]) => mockFindMany(...args),
    },
    file: {
      findMany: (...args: any[]) => mockFindMany(...args),
      findUnique: (...args: any[]) => mockFindUnique(...args),
      update: (...args: any[]) => mockUpdate(...args),
      updateMany: (...args: any[]) => mockUpdateMany(...args),
    },
  },
}));

vi.mock('@/lib/api-key-middleware', () => ({
  verifyApiKey: vi.fn()
}));

vi.mock('@/lib/redis-cache', () => ({
  invalidateCachedFile: vi.fn(),
  getCachedFile: vi.fn(),
}));

// The SDK's Streamable HTTP transport requires clients to declare they
// accept both media types, and 406s otherwise - a real spec requirement
// (https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)
// the previous hand-rolled route never enforced.
const mcpHeaders = { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' };

function mcpRequest(body: unknown) {
  return new Request('http://localhost/api/mcp', {
    method: 'POST',
    headers: mcpHeaders,
    body: JSON.stringify(body),
  });
}

describe('Model Context Protocol (MCP) HTTP Endpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 401 when API Key is missing or invalid', async () => {
    vi.mocked(verifyApiKey).mockResolvedValueOnce({
      isValid: false,
      userEmail: null,
      scope: null,
      error: 'Authorization header missing',
      statusCode: 401
    });

    const res = await mcpPOST(mcpRequest({ jsonrpc: '2.0', method: 'tools/list', id: 1 }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.message).toBe('Authorization header missing');
  });

  it('should reject requests missing the required Streamable HTTP Accept header', async () => {
    vi.mocked(verifyApiKey).mockResolvedValueOnce({
      isValid: true,
      userEmail: 'dev@collabpro.com',
      scope: 'read-write'
    });

    const req = new Request('http://localhost/api/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 }),
    });

    const res = await mcpPOST(req);
    expect(res.status).toBe(406);
  });

  it('should return a JSON-RPC parse error on invalid JSON body', async () => {
    vi.mocked(verifyApiKey).mockResolvedValueOnce({
      isValid: true,
      userEmail: 'dev@collabpro.com',
      scope: 'read-write'
    });

    const req = new Request('http://localhost/api/mcp', {
      method: 'POST',
      headers: mcpHeaders,
      body: 'invalid-non-json-string'
    });

    const res = await mcpPOST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe(-32700);
  });

  it('declares the tools capability on initialize (spec MUST for a server offering tools)', async () => {
    vi.mocked(verifyApiKey).mockResolvedValueOnce({
      isValid: true,
      userEmail: 'dev@collabpro.com',
      scope: 'read-write'
    });

    const res = await mcpPOST(mcpRequest({
      jsonrpc: '2.0',
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } },
      id: 5,
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.capabilities.tools).toBeTruthy();
    expect(body.result.serverInfo.name).toBe('collabpro-mcp-server');
  });

  it('should support tools/list method and auto-generate JSON Schema from the Zod definitions', async () => {
    vi.mocked(verifyApiKey).mockResolvedValueOnce({
      isValid: true,
      userEmail: 'dev@collabpro.com',
      scope: 'read-write'
    });

    const res = await mcpPOST(mcpRequest({ jsonrpc: '2.0', method: 'tools/list', id: 10 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(10);
    expect(body.result.tools).toHaveLength(4);

    const names = body.result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual([
      'collabpro_list_files',
      'collabpro_get_file',
      'collabpro_update_document',
      'collabpro_update_whiteboard',
    ]);

    const getFile = body.result.tools.find((t: { name: string }) => t.name === 'collabpro_get_file');
    expect(getFile.inputSchema.required).toEqual(['fileId']);
  });

  it('should list user files under authorized scope via collabpro_list_files', async () => {
    vi.mocked(verifyApiKey).mockResolvedValueOnce({
      isValid: true,
      userEmail: 'dev@collabpro.com',
      scope: 'read-write'
    });

    // Mock memberships and file listings
    mockFindMany.mockResolvedValueOnce([{ teamId: 'team-123' }]); // teamMember findMany
    mockFindMany.mockResolvedValueOnce([
      { id: 'file-1', fileName: 'System Specs', teamId: 'team-123' }
    ]); // file findMany

    const res = await mcpPOST(mcpRequest({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'collabpro_list_files', arguments: { scope: 'team' } },
      id: 20,
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.content[0].text).toContain('System Specs');
  });

  it('rejects tools/call with missing required arguments via SDK/Zod validation, before the handler runs', async () => {
    vi.mocked(verifyApiKey).mockResolvedValueOnce({
      isValid: true,
      userEmail: 'dev@collabpro.com',
      scope: 'read-write'
    });

    const res = await mcpPOST(mcpRequest({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'collabpro_get_file', arguments: {} },
      id: 25,
    }));

    // Tool-level errors (including SDK arg validation) come back as a
    // successful JSON-RPC envelope with isError:true in the tool result,
    // not an HTTP-level error - this is correct per the MCP spec.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain('fileId');
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it('should protect write tools against read-only API Keys', async () => {
    vi.mocked(verifyApiKey).mockResolvedValueOnce({
      isValid: true,
      userEmail: 'dev@collabpro.com',
      scope: 'read-only'
    });

    const res = await mcpPOST(mcpRequest({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'collabpro_update_document', arguments: { fileId: 'file-1', document: '{}' } },
      id: 30,
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain('Forbidden');
  });

  it('collabpro_update_document actually persists via the shared CAS writer, not a raw overwrite', async () => {
    vi.mocked(verifyApiKey).mockResolvedValueOnce({
      isValid: true,
      userEmail: 'dev@collabpro.com',
      scope: 'read-write'
    });

    mockFindMany.mockResolvedValueOnce([{ teamId: 'team-123' }]); // teamMember findMany
    mockFindUnique.mockResolvedValueOnce({ id: 'file-1', teamId: 'team-123' }); // access check
    mockFindUnique.mockResolvedValueOnce({ document: '' }); // casUpdateDocument's own read
    mockUpdateMany.mockResolvedValueOnce({ count: 1 });

    const res = await mcpPOST(mcpRequest({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'collabpro_update_document',
        arguments: { fileId: 'file-1', document: { time: 1, version: '2.8.1', blocks: [{ id: 'b1', type: 'paragraph', data: { text: 'hi' } }] } }
      },
      id: 40,
    }));

    expect(res.status).toBe(200);
    expect(mockUpdateMany).toHaveBeenCalled();
    const body = await res.json();
    expect(body.result.content[0].text).toContain('"updated": true');
  });

  it('collabpro_update_whiteboard accepts a structured elements array and parses the CAS writer\'s JSON-string return before embedding', async () => {
    vi.mocked(verifyApiKey).mockResolvedValueOnce({
      isValid: true,
      userEmail: 'dev@collabpro.com',
      scope: 'read-write'
    });

    mockFindMany.mockResolvedValueOnce([{ teamId: 'team-123' }]);
    mockFindUnique.mockResolvedValueOnce({ id: 'file-1', teamId: 'team-123' });
    mockFindUnique.mockResolvedValueOnce({ whiteboard: '' });
    mockUpdateMany.mockResolvedValueOnce({ count: 1 });

    const res = await mcpPOST(mcpRequest({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'collabpro_update_whiteboard',
        arguments: { fileId: 'file-1', whiteboard: [{ id: 'el-1', type: 'rectangle', x: 0, y: 0, width: 10, height: 10 }] }
      },
      id: 41,
    }));

    expect(res.status).toBe(200);
    expect(mockUpdateMany).toHaveBeenCalled();

    // Regression: casUpdateWhiteboard returns a JSON *string*, unlike
    // casUpdateDocument's plain object - embedding it directly double-encoded
    // the whiteboard as an escaped string instead of real JSON in the tool
    // result.
    const body = await res.json();
    const parsedResultText = JSON.parse(body.result.content[0].text);
    expect(typeof parsedResultText.whiteboard).toBe('object');
    expect(parsedResultText.whiteboard.elements[0].id).toBe('el-1');
  });
});
