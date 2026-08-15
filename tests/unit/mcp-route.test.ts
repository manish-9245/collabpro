import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST as mcpPOST } from '@/app/api/mcp/route';
import { verifyApiKey } from '@/lib/api-key-middleware';
import { checkRateLimit } from '@/lib/rate-limiter';
import { logAuditEvent } from '@/lib/audit';
import { storeIconPlacement } from '@/lib/mcp/icon-placement-cache';

// Mock database prisma
const mockFindMany = vi.fn();
const mockFindUnique = vi.fn();
const mockUpdate = vi.fn();
const mockUpdateMany = vi.fn();
const mockCreate = vi.fn();
const mockTeamFindMany = vi.fn();

vi.mock('@/lib/db', () => ({
  prisma: {
    team: {
      findMany: (...args: any[]) => mockTeamFindMany(...args),
    },
    teamMember: {
      findMany: (...args: any[]) => mockFindMany(...args),
    },
    file: {
      findMany: (...args: any[]) => mockFindMany(...args),
      findUnique: (...args: any[]) => mockFindUnique(...args),
      update: (...args: any[]) => mockUpdate(...args),
      updateMany: (...args: any[]) => mockUpdateMany(...args),
      create: (...args: any[]) => mockCreate(...args),
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

vi.mock('@/lib/rate-limiter', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 119, resetAt: Date.now() + 60_000, firstBlock: false }),
  getClientIp: () => '203.0.113.1',
  LIMITS: { MCP: { windowMs: 60_000, maxAttempts: 120 } },
}));

vi.mock('@/lib/audit', () => ({
  logAuditEvent: vi.fn(),
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
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, remaining: 119, resetAt: Date.now() + 60_000, firstBlock: false });
    // getAllowedTeamIds unions Team.createdBy with TeamMember rows - default
    // to no created teams so existing tests (which only queue a TeamMember
    // row via mockFindMany) don't need to change.
    mockTeamFindMany.mockResolvedValue([]);
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
    expect(body.result.tools).toHaveLength(8);

    const names = body.result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual([
      'collabpro_list_files',
      'collabpro_get_file',
      'collabpro_create_file',
      'collabpro_update_document',
      'collabpro_update_whiteboard',
      'collabpro_search_icon_libraries',
      'collabpro_list_library_items',
      'collabpro_get_library_icon',
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

  it('lets a team creator (no TeamMember row - see teams:createTeam) list their own team\'s files via MCP', async () => {
    vi.mocked(verifyApiKey).mockResolvedValueOnce({
      isValid: true,
      userEmail: 'owner@collabpro.com',
      scope: 'read-write'
    });

    // teams:createTeam never inserts a TeamMember row for the creator - the
    // owner's only membership signal is Team.createdBy.
    mockTeamFindMany.mockResolvedValueOnce([{ id: 'team-owned' }]);
    mockFindMany.mockResolvedValueOnce([]); // teamMember findMany - no membership row
    mockFindMany.mockResolvedValueOnce([{ id: 'file-1', fileName: 'Owner File', teamId: 'team-owned' }]); // file findMany

    const res = await mcpPOST(mcpRequest({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'collabpro_list_files', arguments: { scope: 'team', teamId: 'team-owned' } },
      id: 21,
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.isError).toBeFalsy();
    expect(body.result.content[0].text).toContain('Owner File');
  });

  it('creates a file via collabpro_create_file when the team is one of the caller\'s own', async () => {
    vi.mocked(verifyApiKey).mockResolvedValueOnce({
      isValid: true,
      userEmail: 'dev@collabpro.com',
      scope: 'read-write'
    });

    mockFindMany.mockResolvedValueOnce([{ teamId: 'team-123' }]); // teamMember findMany (getAllowedTeamIds)
    mockCreate.mockResolvedValueOnce({ id: 'file-new', fileName: 'New MCP File', teamId: 'team-123', document: '', whiteboard: '' });

    const res = await mcpPOST(mcpRequest({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'collabpro_create_file', arguments: { fileName: 'New MCP File', teamId: 'team-123' } },
      id: 22,
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.isError).toBeFalsy();
    expect(body.result.content[0].text).toContain('file-new');
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ fileName: 'New MCP File', teamId: 'team-123', createdBy: 'dev@collabpro.com', document: '', whiteboard: '' }),
    }));
    expect(logAuditEvent).toHaveBeenCalledWith('team-123', 'dev@collabpro.com', 'mcp:create_file', { fileId: 'file-new' }, '203.0.113.1');
  });

  it('rejects collabpro_create_file for a team the caller does not belong to', async () => {
    vi.mocked(verifyApiKey).mockResolvedValueOnce({
      isValid: true,
      userEmail: 'dev@collabpro.com',
      scope: 'read-write'
    });

    mockFindMany.mockResolvedValueOnce([{ teamId: 'team-123' }]); // teamMember findMany - caller only belongs to team-123

    const res = await mcpPOST(mcpRequest({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'collabpro_create_file', arguments: { fileName: 'Nope', teamId: 'someone-elses-team' } },
      id: 23,
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain('access denied');
    expect(mockCreate).not.toHaveBeenCalled();
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

  it('rejects overlapping shapes in a whiteboard write instead of persisting them', async () => {
    vi.mocked(verifyApiKey).mockResolvedValueOnce({
      isValid: true,
      userEmail: 'dev@collabpro.com',
      scope: 'read-write',
    });

    mockFindMany.mockResolvedValueOnce([{ teamId: 'team-123' }]);
    mockFindUnique.mockResolvedValueOnce({ id: 'file-1', teamId: 'team-123' });

    const res = await mcpPOST(mcpRequest({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'collabpro_update_whiteboard',
        arguments: {
          fileId: 'file-1',
          whiteboard: [
            { id: 'a', type: 'rectangle', x: 0, y: 0, width: 100, height: 100 },
            { id: 'b', type: 'rectangle', x: 50, y: 50, width: 100, height: 100 },
          ],
        },
      },
      id: 95,
    }));

    const body = await res.json();
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain('"a" and "b" overlap');
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it('allows overlapping shapes that share a groupIds entry (a composite icon, e.g. a real AWS library item)', async () => {
    // Regression: a real community-library icon (AWS EC2 Cluster - ellipse +
    // 3 nested rectangles + text, fetched from
    // excalidraw/excalidraw-libraries and round-tripped through this exact
    // server during manual testing) was rejected outright by the original
    // overlap check, because icon primitives are deliberately drawn on top
    // of each other. Shared groupIds is Excalidraw's own "these are one
    // visual unit" signal, and how the real library file tags this icon's
    // parts already.
    vi.mocked(verifyApiKey).mockResolvedValueOnce({
      isValid: true,
      userEmail: 'dev@collabpro.com',
      scope: 'read-write',
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
        arguments: {
          fileId: 'file-1',
          whiteboard: [
            { id: 'icon-bg', type: 'ellipse', x: 900, y: 40, width: 74, height: 76, groupIds: ['ec2-icon'] },
            { id: 'icon-part-1', type: 'rectangle', x: 920, y: 49, width: 24, height: 25, groupIds: ['icon-parts', 'ec2-icon'] },
            { id: 'icon-part-2', type: 'rectangle', x: 924, y: 54, width: 24, height: 25, groupIds: ['icon-parts', 'ec2-icon'] },
          ],
        },
      },
      id: 98,
    }));

    const body = await res.json();
    expect(body.result.isError).toBeUndefined();
    expect(mockUpdateMany).toHaveBeenCalled();
  });

  it('still rejects overlapping shapes with no shared groupIds (unrelated diagram boxes, not a composite icon)', async () => {
    vi.mocked(verifyApiKey).mockResolvedValueOnce({
      isValid: true,
      userEmail: 'dev@collabpro.com',
      scope: 'read-write',
    });

    mockFindMany.mockResolvedValueOnce([{ teamId: 'team-123' }]);
    mockFindUnique.mockResolvedValueOnce({ id: 'file-1', teamId: 'team-123' });

    const res = await mcpPOST(mcpRequest({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'collabpro_update_whiteboard',
        arguments: {
          fileId: 'file-1',
          whiteboard: [
            { id: 'a', type: 'rectangle', x: 0, y: 0, width: 100, height: 100, groupIds: ['group-a'] },
            { id: 'b', type: 'rectangle', x: 50, y: 50, width: 100, height: 100, groupIds: ['group-b'] },
          ],
        },
      },
      id: 99,
    }));

    const body = await res.json();
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain('"a" and "b" overlap');
  });

  it('rejects non-finite coordinates in a whiteboard write', async () => {
    vi.mocked(verifyApiKey).mockResolvedValueOnce({
      isValid: true,
      userEmail: 'dev@collabpro.com',
      scope: 'read-write',
    });

    mockFindMany.mockResolvedValueOnce([{ teamId: 'team-123' }]);
    mockFindUnique.mockResolvedValueOnce({ id: 'file-1', teamId: 'team-123' });

    const res = await mcpPOST(mcpRequest({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'collabpro_update_whiteboard',
        arguments: {
          fileId: 'file-1',
          whiteboard: [{ id: 'a', type: 'rectangle', x: NaN, y: 0, width: 100, height: 100 }],
        },
      },
      id: 96,
    }));

    const body = await res.json();
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain('finite numbers');
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it('allows non-overlapping shapes with adequate spacing through to the CAS writer', async () => {
    vi.mocked(verifyApiKey).mockResolvedValueOnce({
      isValid: true,
      userEmail: 'dev@collabpro.com',
      scope: 'read-write',
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
        arguments: {
          fileId: 'file-1',
          whiteboard: [
            { id: 'a', type: 'rectangle', x: 0, y: 0, width: 100, height: 100 },
            { id: 'b', type: 'rectangle', x: 200, y: 0, width: 100, height: 100 },
          ],
        },
      },
      id: 97,
    }));

    const body = await res.json();
    expect(body.result.isError).toBeUndefined();
    expect(mockUpdateMany).toHaveBeenCalled();
  });

  it('collabpro_update_whiteboard places an icon via iconRefs, merged onto an explicit whiteboard array', async () => {
    const ref = storeIconPlacement('EC2', [{ id: 'icon_el', type: 'rectangle', x: 300, y: 300, width: 50, height: 50, groupIds: ['icon_grp'] }]);

    vi.mocked(verifyApiKey).mockResolvedValueOnce({
      isValid: true,
      userEmail: 'dev@collabpro.com',
      scope: 'read-write',
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
        arguments: {
          fileId: 'file-1',
          whiteboard: [{ id: 'a', type: 'rectangle', x: 0, y: 0, width: 100, height: 100 }],
          iconRefs: [ref],
        },
      },
      id: 100,
    }));

    const body = await res.json();
    expect(body.result.isError).toBeUndefined();
    const saved = JSON.parse(body.result.content[0].text);
    const elementIds = saved.whiteboard.elements.map((e: any) => e.id);
    expect(elementIds).toEqual(['a', 'icon_el']);
  });

  it('collabpro_update_whiteboard places icons via iconRefs alone (no "whiteboard" arg) without wiping the rest of the board', async () => {
    const ref = storeIconPlacement('EC2', [{ id: 'icon_el', type: 'rectangle', x: 300, y: 300, width: 50, height: 50 }]);

    vi.mocked(verifyApiKey).mockResolvedValueOnce({
      isValid: true,
      userEmail: 'dev@collabpro.com',
      scope: 'read-write',
    });
    mockFindMany.mockResolvedValueOnce([{ teamId: 'team-123' }]);
    mockFindUnique.mockResolvedValueOnce({ id: 'file-1', teamId: 'team-123' });
    // Existing board already has one element - an empty-delta merge (the
    // "iconRefs only" path) must preserve it, not replace the board.
    mockFindUnique.mockResolvedValueOnce({
      whiteboard: JSON.stringify({ elements: [{ id: 'existing', type: 'rectangle', x: 0, y: 0, width: 10, height: 10 }], files: {} }),
    });
    mockUpdateMany.mockResolvedValueOnce({ count: 1 });

    const res = await mcpPOST(mcpRequest({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'collabpro_update_whiteboard',
        arguments: { fileId: 'file-1', iconRefs: [ref] },
      },
      id: 101,
    }));

    const body = await res.json();
    expect(body.result.isError).toBeUndefined();
    const saved = JSON.parse(body.result.content[0].text);
    const elementIds = saved.whiteboard.elements.map((e: any) => e.id);
    expect(elementIds).toEqual(['existing', 'icon_el']);
  });

  it('collabpro_update_whiteboard MERGES a plain "whiteboard" array onto the existing board by default - the fix for a later call silently wiping an earlier one', async () => {
    // Regression: this tool used to treat a plain array as a full REPLACE.
    // An agent placing one node per call (a completely natural way to
    // build a diagram) would have each call discard everything the
    // previous call wrote, since it only ever echoed the new node.
    vi.mocked(verifyApiKey).mockResolvedValueOnce({
      isValid: true,
      userEmail: 'dev@collabpro.com',
      scope: 'read-write',
    });
    mockFindMany.mockResolvedValueOnce([{ teamId: 'team-123' }]);
    mockFindUnique.mockResolvedValueOnce({ id: 'file-1', teamId: 'team-123' });
    mockFindUnique.mockResolvedValueOnce({
      whiteboard: JSON.stringify({ elements: [{ id: 'earlier-node', type: 'rectangle', x: 0, y: 0, width: 50, height: 50 }], files: {} }),
    });
    mockUpdateMany.mockResolvedValueOnce({ count: 1 });

    const res = await mcpPOST(mcpRequest({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'collabpro_update_whiteboard',
        arguments: { fileId: 'file-1', whiteboard: [{ id: 'new-node', type: 'rectangle', x: 200, y: 0, width: 50, height: 50 }] },
      },
      id: 104,
    }));

    const body = await res.json();
    expect(body.result.isError).toBeUndefined();
    const saved = JSON.parse(body.result.content[0].text);
    const elementIds = saved.whiteboard.elements.map((e: any) => e.id);
    expect(elementIds).toEqual(['earlier-node', 'new-node']);
  });

  it('collabpro_update_whiteboard removes elements listed in "deleted" while merging the rest', async () => {
    vi.mocked(verifyApiKey).mockResolvedValueOnce({
      isValid: true,
      userEmail: 'dev@collabpro.com',
      scope: 'read-write',
    });
    mockFindMany.mockResolvedValueOnce([{ teamId: 'team-123' }]);
    mockFindUnique.mockResolvedValueOnce({ id: 'file-1', teamId: 'team-123' });
    mockFindUnique.mockResolvedValueOnce({
      whiteboard: JSON.stringify({
        elements: [
          { id: 'keep-me', type: 'rectangle', x: 0, y: 0, width: 50, height: 50 },
          { id: 'remove-me', type: 'rectangle', x: 200, y: 0, width: 50, height: 50 },
        ],
        files: {},
      }),
    });
    mockUpdateMany.mockResolvedValueOnce({ count: 1 });

    const res = await mcpPOST(mcpRequest({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'collabpro_update_whiteboard', arguments: { fileId: 'file-1', deleted: ['remove-me'] } },
      id: 105,
    }));

    const body = await res.json();
    expect(body.result.isError).toBeUndefined();
    const saved = JSON.parse(body.result.content[0].text);
    const elementIds = saved.whiteboard.elements.map((e: any) => e.id);
    expect(elementIds).toEqual(['keep-me']);
  });

  it('collabpro_update_whiteboard with replaceAll:true still fully replaces the board, discarding anything not included', async () => {
    vi.mocked(verifyApiKey).mockResolvedValueOnce({
      isValid: true,
      userEmail: 'dev@collabpro.com',
      scope: 'read-write',
    });
    mockFindMany.mockResolvedValueOnce([{ teamId: 'team-123' }]);
    mockFindUnique.mockResolvedValueOnce({ id: 'file-1', teamId: 'team-123' });
    mockFindUnique.mockResolvedValueOnce({
      whiteboard: JSON.stringify({ elements: [{ id: 'old-node', type: 'rectangle', x: 0, y: 0, width: 50, height: 50 }], files: {} }),
    });
    mockUpdateMany.mockResolvedValueOnce({ count: 1 });

    const res = await mcpPOST(mcpRequest({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'collabpro_update_whiteboard',
        arguments: { fileId: 'file-1', whiteboard: [{ id: 'only-node', type: 'rectangle', x: 0, y: 0, width: 50, height: 50 }], replaceAll: true },
      },
      id: 106,
    }));

    const body = await res.json();
    expect(body.result.isError).toBeUndefined();
    const saved = JSON.parse(body.result.content[0].text);
    const elementIds = saved.whiteboard.elements.map((e: any) => e.id);
    expect(elementIds).toEqual(['only-node']);
  });

  it('collabpro_update_whiteboard rejects replaceAll:true without "whiteboard"', async () => {
    vi.mocked(verifyApiKey).mockResolvedValueOnce({
      isValid: true,
      userEmail: 'dev@collabpro.com',
      scope: 'read-write',
    });

    const res = await mcpPOST(mcpRequest({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'collabpro_update_whiteboard', arguments: { fileId: 'file-1', replaceAll: true } },
      id: 107,
    }));

    const body = await res.json();
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain('"whiteboard" is required when "replaceAll" is true');
  });

  it('collabpro_update_whiteboard rejects an unknown or expired icon ref with a helpful message', async () => {
    vi.mocked(verifyApiKey).mockResolvedValueOnce({
      isValid: true,
      userEmail: 'dev@collabpro.com',
      scope: 'read-write',
    });
    mockFindMany.mockResolvedValueOnce([{ teamId: 'team-123' }]);
    mockFindUnique.mockResolvedValueOnce({ id: 'file-1', teamId: 'team-123' });

    const res = await mcpPOST(mcpRequest({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'collabpro_update_whiteboard',
        arguments: { fileId: 'file-1', iconRefs: ['iconref_bogus'] },
      },
      id: 102,
    }));

    const body = await res.json();
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain('unknown or has expired');
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it('collabpro_update_whiteboard requires at least "whiteboard" or "iconRefs"', async () => {
    vi.mocked(verifyApiKey).mockResolvedValueOnce({
      isValid: true,
      userEmail: 'dev@collabpro.com',
      scope: 'read-write',
    });

    const res = await mcpPOST(mcpRequest({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'collabpro_update_whiteboard', arguments: { fileId: 'file-1' } },
      id: 103,
    }));

    const body = await res.json();
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain('Provide "whiteboard"');
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it('returns 429 with Retry-After once the per-key rate limit is exceeded', async () => {
    vi.mocked(verifyApiKey).mockResolvedValueOnce({
      isValid: true,
      userEmail: 'dev@collabpro.com',
      scope: 'read-write',
      apiKeyId: 'key-1',
    });
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: Date.now() + 5000, firstBlock: true });

    const res = await mcpPOST(mcpRequest({ jsonrpc: '2.0', method: 'tools/list', id: 50 }));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBeTruthy();
    expect(logAuditEvent).toHaveBeenCalledWith(null, 'dev@collabpro.com', 'mcp:rate_limited', {}, '203.0.113.1');
  });

  it('does not double-log rate-limit audit events for repeat requests within the same blocked window', async () => {
    vi.mocked(verifyApiKey).mockResolvedValue({
      isValid: true,
      userEmail: 'dev@collabpro.com',
      scope: 'read-write',
      apiKeyId: 'key-1',
    });
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() + 5000, firstBlock: false });

    await mcpPOST(mcpRequest({ jsonrpc: '2.0', method: 'tools/list', id: 51 }));
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('rejects request bodies over the byte-size cap before parsing them', async () => {
    vi.mocked(verifyApiKey).mockResolvedValueOnce({
      isValid: true,
      userEmail: 'dev@collabpro.com',
      scope: 'read-write',
    });

    const oversized = 'x'.repeat(5 * 1024 * 1024 + 1);
    const req = new Request('http://localhost/api/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'collabpro_update_document', arguments: { fileId: 'f', document: oversized } }, id: 60 }),
    });

    const res = await mcpPOST(req);
    expect(res.status).toBe(413);
  });

  it('logs an audit event on auth failure', async () => {
    vi.mocked(verifyApiKey).mockResolvedValueOnce({
      isValid: false,
      userEmail: null,
      scope: null,
      error: 'Invalid API key or token has been revoked',
      statusCode: 401,
    });

    await mcpPOST(mcpRequest({ jsonrpc: '2.0', method: 'tools/list', id: 70 }));
    expect(logAuditEvent).toHaveBeenCalledWith(null, 'unknown', 'mcp:auth:failure', { reason: 'Invalid API key or token has been revoked' }, '203.0.113.1');
  });

  it('logs an audit event when collabpro_update_document persists a write', async () => {
    vi.mocked(verifyApiKey).mockResolvedValueOnce({
      isValid: true,
      userEmail: 'dev@collabpro.com',
      scope: 'read-write',
    });

    mockFindMany.mockResolvedValueOnce([{ teamId: 'team-123' }]);
    mockFindUnique.mockResolvedValueOnce({ id: 'file-1', teamId: 'team-123' });
    mockFindUnique.mockResolvedValueOnce({ document: '' });
    mockUpdateMany.mockResolvedValueOnce({ count: 1 });

    await mcpPOST(mcpRequest({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'collabpro_update_document', arguments: { fileId: 'file-1', document: { blocks: [] } } },
      id: 80,
    }));

    expect(logAuditEvent).toHaveBeenCalledWith('team-123', 'dev@collabpro.com', 'mcp:update_document', { fileId: 'file-1' }, '203.0.113.1');
  });

  it('every tool advertises MCP annotations (readOnlyHint/destructiveHint) so clients can reason about risk', async () => {
    vi.mocked(verifyApiKey).mockResolvedValueOnce({
      isValid: true,
      userEmail: 'dev@collabpro.com',
      scope: 'read-write',
    });

    const res = await mcpPOST(mcpRequest({ jsonrpc: '2.0', method: 'tools/list', id: 90 }));
    const body = await res.json();
    const byName: Record<string, any> = Object.fromEntries(body.result.tools.map((t: any) => [t.name, t.annotations]));

    expect(byName.collabpro_list_files.readOnlyHint).toBe(true);
    expect(byName.collabpro_get_file.readOnlyHint).toBe(true);
    expect(byName.collabpro_update_document.destructiveHint).toBe(true);
    expect(byName.collabpro_update_whiteboard.destructiveHint).toBe(true);
  });

  it('collabpro_list_files paginates and returns a nextCursor when more rows exist than the limit', async () => {
    vi.mocked(verifyApiKey).mockResolvedValueOnce({
      isValid: true,
      userEmail: 'dev@collabpro.com',
      scope: 'read-write',
    });

    mockFindMany.mockResolvedValueOnce([{ teamId: 'team-123' }]); // teamMember findMany
    mockFindMany.mockResolvedValueOnce([
      { id: 'file-1', fileName: 'A' },
      { id: 'file-2', fileName: 'B' },
    ]); // file findMany: limit(1) + 1 lookahead row

    const res = await mcpPOST(mcpRequest({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'collabpro_list_files', arguments: { limit: 1 } },
      id: 91,
    }));

    const body = await res.json();
    const parsed = JSON.parse(body.result.content[0].text);
    expect(parsed.files).toHaveLength(1);
    expect(parsed.nextCursor).toBe('file-1');
  });
});
