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

    const req = new Request('http://localhost/api/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 })
    });

    const res = await mcpPOST(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.message).toBe('Authorization header missing');
  });

  it('should return 400 on Parse Error / invalid JSON body', async () => {
    vi.mocked(verifyApiKey).mockResolvedValueOnce({
      isValid: true,
      userEmail: 'dev@collabpro.com',
      scope: 'read-write'
    });

    const req = new Request('http://localhost/api/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer collabpro_pat_abc' },
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

    const req = new Request('http://localhost/api/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer collabpro_pat_abc' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 5 })
    });

    const res = await mcpPOST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.capabilities).toEqual({ tools: {} });
  });

  it('should support tools/list method', async () => {
    vi.mocked(verifyApiKey).mockResolvedValueOnce({
      isValid: true,
      userEmail: 'dev@collabpro.com',
      scope: 'read-write'
    });

    const req = new Request('http://localhost/api/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer collabpro_pat_abc' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 10 })
    });

    const res = await mcpPOST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(10);
    expect(body.result.tools).toHaveLength(4);
    expect(body.result.tools[0].name).toBe('collabpro_list_files');
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

    const req = new Request('http://localhost/api/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer collabpro_pat_abc' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'collabpro_list_files',
          arguments: { scope: 'team' }
        },
        id: 20
      })
    });

    const res = await mcpPOST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.content[0].text).toContain('System Specs');
  });

  it('should protect write tools against read-only API Keys', async () => {
    vi.mocked(verifyApiKey).mockResolvedValueOnce({
      isValid: true,
      userEmail: 'dev@collabpro.com',
      scope: 'read-only'
    });

    const req = new Request('http://localhost/api/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer collabpro_pat_abc' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'collabpro_update_document',
          arguments: { fileId: 'file-1', document: '{}' }
        },
        id: 30
      })
    });

    const res = await mcpPOST(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.message).toContain('Forbidden');
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

    const req = new Request('http://localhost/api/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer collabpro_pat_abc' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'collabpro_update_document',
          arguments: { fileId: 'file-1', document: { time: 1, version: '2.8.1', blocks: [{ id: 'b1', type: 'paragraph', data: { text: 'hi' } }] } }
        },
        id: 40
      })
    });

    const res = await mcpPOST(req);
    expect(res.status).toBe(200);
    expect(mockUpdateMany).toHaveBeenCalled();
    const body = await res.json();
    expect(body.result.content[0].text).toContain('"updated": true');
  });

  it('collabpro_update_whiteboard accepts a structured elements array (schema now matches scripts/mcp-server.ts)', async () => {
    vi.mocked(verifyApiKey).mockResolvedValueOnce({
      isValid: true,
      userEmail: 'dev@collabpro.com',
      scope: 'read-write'
    });

    mockFindMany.mockResolvedValueOnce([{ teamId: 'team-123' }]);
    mockFindUnique.mockResolvedValueOnce({ id: 'file-1', teamId: 'team-123' });
    mockFindUnique.mockResolvedValueOnce({ whiteboard: '' });
    mockUpdateMany.mockResolvedValueOnce({ count: 1 });

    const req = new Request('http://localhost/api/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer collabpro_pat_abc' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'collabpro_update_whiteboard',
          arguments: { fileId: 'file-1', whiteboard: [{ id: 'el-1', type: 'rectangle', x: 0, y: 0, width: 10, height: 10 }] }
        },
        id: 41
      })
    });

    const res = await mcpPOST(req);
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
