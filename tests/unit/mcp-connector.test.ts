import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const db = vi.hoisted(() => ({
  teamFindMany: vi.fn(), memberFindMany: vi.fn(), fileFindMany: vi.fn(), fileFindUnique: vi.fn(),
  fileUpdateMany: vi.fn(), fileCreate: vi.fn(), fileDeleteMany: vi.fn(), aiFindFirst: vi.fn(), aiFindUnique: vi.fn(),
}));
vi.mock('@/lib/db', () => ({
  prisma: {
    team: { findMany: db.teamFindMany },
    teamMember: { findMany: db.memberFindMany },
    file: { findMany: db.fileFindMany, findUnique: db.fileFindUnique, updateMany: db.fileUpdateMany, create: db.fileCreate, deleteMany: db.fileDeleteMany },
    teamAiSettings: { findFirst: db.aiFindFirst, findUnique: db.aiFindUnique },
  },
}));
vi.mock('@/lib/api-key-middleware', () => ({ verifyApiKey: vi.fn() }));
vi.mock('@/lib/redis-cache', () => ({ invalidateCachedFile: vi.fn() }));
vi.mock('@/lib/rate-limiter', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 1, resetAt: Date.now() + 1000, firstBlock: false }),
  getClientIp: () => '203.0.113.1',
  LIMITS: { MCP: {}, MCP_AUTH_FAIL_AUDIT: {}, MCP_AUTH_FAIL_AUDIT_GLOBAL: {} },
}));
vi.mock('@/lib/audit', () => ({ logAuditEvent: vi.fn() }));
const cas = vi.hoisted(() => {
  class CasConflictError extends Error {}
  return { casUpdateWhiteboard: vi.fn(), casUpdateDocument: vi.fn(), CasConflictError };
});
vi.mock('@/lib/cas-writes', () => cas);

import { POST } from '@/app/api/mcp/route';
import { verifyApiKey } from '@/lib/api-key-middleware';

const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
let rpcId = 1;
const call = (name: string, args: Record<string, unknown>) =>
  POST(new Request('https://app.example.com/api/mcp', { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params: { name, arguments: args } }) }));
// create_diagram streams (SSE) so it can send progress; every other tool is plain JSON.
async function rpc(res: Response) {
  if (res.headers.get('content-type')?.includes('text/event-stream')) {
    const text = await res.text();
    const data = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => JSON.parse(l.slice(5).trim()));
    return data.find((m) => m.result || m.error) ?? {};
  }
  return res.json();
}
const result = async (res: Response) => (await rpc(res)).result;
const asUser = (scope = 'read-write') => vi.mocked(verifyApiKey).mockResolvedValue({ isValid: true, userEmail: 'u@x.co', scope });

const FILE = {
  id: 'f1', fileName: 'Design', teamId: 't1', createdBy: 'u@x.co', archive: false, folder: null,
  document: JSON.stringify({ blocks: [{ type: 'paragraph', data: { text: 'checkout flow notes' } }] }),
  whiteboard: '', whiteboardText: '',
};

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.MCP_DISABLED; delete process.env.MCP_READ_ONLY; delete process.env.MCP_DISABLED_TOOLS;
  db.teamFindMany.mockImplementation(async (args: any) => (args?.where?.createdBy ? [{ id: 't1' }] : [{ id: 't1', teamName: 'Core', description: '' }]));
  db.memberFindMany.mockResolvedValue([]);
  db.fileFindUnique.mockResolvedValue(FILE);
  db.aiFindFirst.mockResolvedValue(null);
  db.aiFindUnique.mockResolvedValue(null);
  db.fileDeleteMany.mockResolvedValue({ count: 1 });
  cas.casUpdateWhiteboard.mockImplementation(async (_p: unknown, _id: string, payload: unknown) => JSON.stringify(payload));
});
afterEach(() => { delete process.env.MCP_DISABLED; delete process.env.MCP_READ_ONLY; delete process.env.MCP_DISABLED_TOOLS; });

describe('401 starts OAuth discovery', () => {
  it('missing credentials -> 401 + WWW-Authenticate with resource_metadata', async () => {
    vi.mocked(verifyApiKey).mockResolvedValue({ isValid: false, userEmail: null, scope: null, error: 'Authorization header missing', statusCode: 401 });
    const res = await call('collabpro_list_teams', {});
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toBe('Bearer resource_metadata="https://app.example.com/.well-known/oauth-protected-resource"');
  });
  it('bad token adds error="invalid_token"', async () => {
    vi.mocked(verifyApiKey).mockResolvedValue({ isValid: false, userEmail: null, scope: null, error: 'Invalid or expired access token', statusCode: 401 });
    const res = await POST(new Request('https://app.example.com/api/mcp', { method: 'POST', headers: { ...headers, Authorization: 'Bearer collabpro_oat_x' }, body: '{}' }));
    expect(res.headers.get('WWW-Authenticate')).toContain('error="invalid_token"');
  });
  it('403 (scope) carries no WWW-Authenticate', async () => {
    vi.mocked(verifyApiKey).mockResolvedValue({ isValid: false, userEmail: 'u@x.co', scope: 'read-only', error: 'Forbidden', statusCode: 403 });
    const res = await call('collabpro_list_teams', {});
    expect(res.status).toBe(403);
    expect(res.headers.get('WWW-Authenticate')).toBeNull();
  });
  it('opts in to OAuth tokens', async () => {
    vi.mocked(verifyApiKey).mockResolvedValue({ isValid: false, userEmail: null, scope: null, error: 'x', statusCode: 401 });
    await call('collabpro_list_teams', {});
    expect(verifyApiKey).toHaveBeenCalledWith(null, undefined, { allowOAuth: true });
  });
});

describe('operator kill switches', () => {
  it('MCP_DISABLED -> 503 before auth', async () => {
    process.env.MCP_DISABLED = 'true';
    const res = await call('collabpro_list_teams', {});
    expect(res.status).toBe(503);
    expect(verifyApiKey).not.toHaveBeenCalled();
  });
  it('MCP_READ_ONLY blocks writes even for read-write credentials', async () => {
    process.env.MCP_READ_ONLY = 'true';
    asUser('read-write');
    const r = await result(await call('collabpro_update_document', { fileId: 'f1', document: { blocks: [] } }));
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/read-only/);
    expect(cas.casUpdateDocument).not.toHaveBeenCalled();
  });
  it('MCP_DISABLED_TOOLS hides and blocks named tools', async () => {
    process.env.MCP_DISABLED_TOOLS = 'collabpro_export_file, collabpro_search';
    asUser();
    const list = await (await POST(new Request('https://app.example.com/api/mcp', { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'tools/list' }) }))).json();
    const names = list.result.tools.map((t: { name: string }) => t.name);
    expect(names).not.toContain('collabpro_export_file');
    expect(names).not.toContain('collabpro_search');
    expect(names).toContain('collabpro_list_teams');
    const blocked = await result(await call('collabpro_export_file', { fileId: 'f1' }));
    expect(blocked.isError).toBe(true);
  });
});

describe('new tools', () => {
  it('list_teams returns structuredContent', async () => {
    asUser();
    const r = await result(await call('collabpro_list_teams', {}));
    expect(r.structuredContent.teams).toEqual([{ id: 't1', teamName: 'Core', description: '' }]);
  });

  it('search returns a snippet around the match', async () => {
    asUser();
    db.fileFindMany.mockResolvedValue([FILE]);
    const r = await result(await call('collabpro_search', { query: 'checkout' }));
    expect(r.structuredContent.results[0]).toMatchObject({ id: 'f1', fileName: 'Design' });
    expect(r.structuredContent.results[0].snippet).toContain('checkout flow');
  });

  it('search scopes to the caller\'s teams only', async () => {
    asUser();
    db.fileFindMany.mockResolvedValue([]);
    await call('collabpro_search', { query: 'secret', teamId: 'someone-elses-team' });
    expect(db.fileFindMany.mock.calls[0][0].where.teamId).toEqual({ in: ['t1'] });
  });

  it('export_file renders markdown, and denies files outside the caller\'s teams', async () => {
    asUser();
    const ok = await result(await call('collabpro_export_file', { fileId: 'f1', format: 'markdown' }));
    expect(ok.structuredContent.content).toContain('checkout flow notes');
    db.fileFindUnique.mockResolvedValue({ ...FILE, teamId: 'other-team' });
    const denied = await result(await call('collabpro_export_file', { fileId: 'f1' }));
    expect(denied.isError).toBe(true);
    expect(denied.content[0].text).toMatch(/not found or access denied/);
  });

  it('get_file exposes versions; baseVersion mismatch is rejected, match is accepted', async () => {
    asUser();
    const got = await result(await call('collabpro_get_file', { fileId: 'f1' }));
    const { documentVersion } = got.structuredContent;
    expect(documentVersion).toMatch(/^[0-9a-f]{16}$/);

    const stale = await result(await call('collabpro_update_document', { fileId: 'f1', document: { blocks: [] }, baseVersion: 'deadbeefdeadbeef' }));
    expect(stale.isError).toBe(true);
    expect(stale.content[0].text).toMatch(/Conflict/);
    expect(cas.casUpdateDocument).not.toHaveBeenCalled();

    cas.casUpdateDocument.mockResolvedValue({ blocks: [] });
    const fresh = await result(await call('collabpro_update_document', { fileId: 'f1', document: { blocks: [] }, baseVersion: documentVersion }));
    expect(fresh.isError).toBeFalsy();
    expect(fresh.structuredContent.updated).toBe(true);
  });

  it('apply_diagram_spec lays out and writes valid elements below existing content', async () => {
    asUser();
    db.fileFindUnique.mockResolvedValue({ ...FILE, whiteboard: JSON.stringify([{ id: 'old', type: 'rectangle', x: 0, y: 0, width: 100, height: 300 }]) });
    const r = await result(await call('collabpro_apply_diagram_spec', {
      fileId: 'f1',
      nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
      edges: [{ from: 'a', to: 'b' }],
    }));
    expect(r.isError).toBeFalsy();
    const payload = cas.casUpdateWhiteboard.mock.calls[0][2];
    expect(payload.isDelta).toBe(true);
    const rects = payload.updated.filter((e: any) => e.type === 'rectangle');
    expect(rects).toHaveLength(2);
    expect(Math.min(...rects.map((e: any) => e.y))).toBeGreaterThanOrEqual(380);
  });

  it('apply_diagram_spec rejects bad specs, foreign files, and read-only scope', async () => {
    asUser();
    const bad = await result(await call('collabpro_apply_diagram_spec', { fileId: 'f1', nodes: [{ id: 'a', label: 'A' }], edges: [{ from: 'a', to: 'nope' }] }));
    expect(bad.isError).toBe(true);
    expect(cas.casUpdateWhiteboard).not.toHaveBeenCalled();

    db.fileFindUnique.mockResolvedValue({ ...FILE, teamId: 'other-team' });
    const foreign = await result(await call('collabpro_apply_diagram_spec', { fileId: 'f1', nodes: [{ id: 'a', label: 'A' }] }));
    expect(foreign.content[0].text).toMatch(/access denied/);

    asUser('read-only');
    db.fileFindUnique.mockResolvedValue(FILE);
    const ro = await result(await call('collabpro_apply_diagram_spec', { fileId: 'f1', nodes: [{ id: 'a', label: 'A' }] }));
    expect(ro.content[0].text).toMatch(/read-only/);
  });
});

describe('optional AI tool', () => {
  const listNames = async () => (await (await POST(new Request('https://app.example.com/api/mcp', { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/list' }) }))).json()).result.tools.map((t: { name: string }) => t.name);

  it('is not offered when no team has a provider configured', async () => {
    asUser();
    expect(await listNames()).not.toContain('collabpro_create_diagram');
  });
  it('is offered when a team provider exists', async () => {
    asUser();
    db.aiFindFirst.mockResolvedValue({ provider: 'openai', baseUrl: 'https://api.example.com/v1', encryptedKey: 'x', model: 'm' });
    expect(await listNames()).toContain('collabpro_create_diagram');
  });
  it('a failing AI lookup never breaks tools/list', async () => {
    asUser();
    db.aiFindFirst.mockRejectedValue(new Error('db down'));
    expect(await listNames()).toContain('collabpro_list_teams');
  });
});


describe('atomic baseVersion + board limits', () => {
  it('passes the expected raw value into the CAS write so a mid-flight edit conflicts', async () => {
    asUser();
    const wb = JSON.stringify({ elements: [] });
    db.fileFindUnique.mockResolvedValue({ ...FILE, whiteboard: wb });
    const version = (await result(await call('collabpro_get_file', { fileId: 'f1' }))).structuredContent.whiteboardVersion;
    cas.casUpdateWhiteboard.mockResolvedValue(JSON.stringify({ elements: [] }));
    await call('collabpro_apply_diagram_spec', { fileId: 'f1', baseVersion: version, nodes: [{ id: 'a', label: 'A' }] });
    expect(cas.casUpdateWhiteboard.mock.calls[0][3]).toMatchObject({ expectedRaw: wb });
  });
  it('turns a CAS conflict into a Conflict tool error (not a 500)', async () => {
    asUser();
    db.fileFindUnique.mockResolvedValue({ ...FILE, whiteboard: '' });
    const version = (await result(await call('collabpro_get_file', { fileId: 'f1' }))).structuredContent.whiteboardVersion;
    cas.casUpdateWhiteboard.mockRejectedValue(new cas.CasConflictError('Conflict: the whiteboard changed since you read it.'));
    const r = await result(await call('collabpro_apply_diagram_spec', { fileId: 'f1', baseVersion: version, nodes: [{ id: 'a', label: 'A' }] }));
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/Conflict/);
  });
  it('rejects a merge that would push the board past 500 elements (existing + new)', async () => {
    asUser();
    const existing = Array.from({ length: 498 }, (_, i) => ({ id: `e${i}`, type: 'rectangle', x: i * 200, y: 0, width: 10, height: 10 }));
    db.fileFindUnique.mockResolvedValue({ ...FILE, whiteboard: JSON.stringify({ elements: existing }) });
    const r = await result(await call('collabpro_apply_diagram_spec', { fileId: 'f1', nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }));
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/max 500/);
    expect(cas.casUpdateWhiteboard).not.toHaveBeenCalled();
  });
  it('two diagrams applied to one board never share element ids (merge cannot overwrite)', async () => {
    asUser();
    db.fileFindUnique.mockResolvedValue(FILE);
    const args = { fileId: 'f1', nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], edges: [{ from: 'a', to: 'b' }] };
    await call('collabpro_apply_diagram_spec', args);
    await call('collabpro_apply_diagram_spec', args);
    const ids = (n: number) => new Set(cas.casUpdateWhiteboard.mock.calls[n][2].updated.map((e: any) => e.id));
    expect([...ids(0)].some((id) => ids(1).has(id))).toBe(false);
  });
});

describe('collabpro_create_diagram uses the TARGET team\'s own provider', () => {
  const call2 = (args: Record<string, unknown>) => call('collabpro_create_diagram', args);
  beforeEach(() => {
    db.aiFindFirst.mockResolvedValue({ id: 'x' }); // the user has SOME team with a provider -> tool is offered
    db.teamFindMany.mockImplementation(async (args: any) => (args?.where?.createdBy ? [{ id: 't1' }, { id: 't2' }] : [{ id: 't1', teamName: 'A', description: '' }]));
  });

  it('looks up the provider for the team the file lives in, not "the first team with one"', async () => {
    asUser();
    db.fileFindUnique.mockResolvedValue({ ...FILE, id: 'f2', teamId: 't2' });
    db.aiFindUnique.mockResolvedValue(null); // team t2 has NO provider (team t1 does)
    const r = await result(await call2({ text: 'checkout flow diagram', fileId: 'f2' }));
    expect(db.aiFindUnique).toHaveBeenCalledWith({ where: { teamId: 't2' } });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/no AI provider/);
    expect(cas.casUpdateWhiteboard).not.toHaveBeenCalled();
  });

  it('rejects a team the caller does not belong to before touching any provider', async () => {
    asUser();
    const r = await result(await call2({ text: 'checkout flow diagram', teamId: 'not-mine', fileName: 'X' }));
    expect(r.isError).toBe(true);
    expect(db.aiFindUnique).not.toHaveBeenCalled();
  });

  it('never creates a file when generation fails or returns an unusable spec (no orphans)', async () => {
    asUser();
    db.aiFindUnique.mockResolvedValue({ provider: 'openai', baseUrl: 'http://127.0.0.1:9/v1', encryptedKey: 'bad', model: 'm' });
    const r = await result(await call2({ text: 'checkout flow diagram', teamId: 't2', fileName: 'New' }));
    expect(r.isError).toBe(true); // key cannot even be decrypted / provider unreachable
    expect(db.fileCreate).not.toHaveBeenCalled();
  });
});
