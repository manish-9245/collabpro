import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import { createHash } from 'crypto';

const store = vi.hoisted(() => ({
  registerClient: vi.fn(),
  exchangeAuthCode: vi.fn(),
  refreshTokens: vi.fn(),
  cleanupExpired: vi.fn().mockResolvedValue({}),
  issueAuthCode: vi.fn(),
  getClient: vi.fn(),
  listGrants: vi.fn(),
  revokeGrant: vi.fn(),
}));
vi.mock('@/lib/oauth/store', () => ({ ...store, redirectUriMatches: (reg: string[], r: string) => reg.includes(r) }));
vi.mock('@/lib/db', () => ({ prisma: {} }));
vi.mock('@/lib/audit', () => ({ logAuditEvent: vi.fn() }));
vi.mock('@/lib/rate-limiter', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 1, resetAt: Date.now() + 1000, firstBlock: false }),
  getClientIp: () => '203.0.113.9',
  LIMITS: { OAUTH_REGISTER: {}, OAUTH_TOKEN: {} },
}));
const session = vi.hoisted(() => ({ user: null as null | { email: string } }));
vi.mock('@/lib/session-auth/server', () => ({ getServerSession: () => ({ getUser: async () => session.user }) }));

import { POST as register } from '@/app/api/oauth/register/route';
import { POST as token } from '@/app/api/oauth/token/route';
import { POST as authorize } from '@/app/api/oauth/authorize/route';
import { GET as prm } from '@/app/.well-known/oauth-protected-resource/[[...path]]/route';
import { GET as asm } from '@/app/.well-known/oauth-authorization-server/route';
import { consentToken, CLAUDE_CALLBACK } from '@/lib/oauth/core';
import { checkRateLimit } from '@/lib/rate-limiter';

beforeAll(() => { process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret-1234'; });
beforeEach(() => { vi.clearAllMocks(); session.user = null; delete process.env.OAUTH_DISABLED; });

const json = (url: string, body: unknown) => new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const formReq = (url: string, body: Record<string, string>, headers: Record<string, string> = {}) =>
  new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(body).toString() });

describe('discovery metadata', () => {
  it('protected resource names the exact MCP URL and issuer', async () => {
    const res = prm(new Request('https://app.example.com/.well-known/oauth-protected-resource'));
    expect(await res.json()).toMatchObject({ resource: 'https://app.example.com/api/mcp', authorization_servers: ['https://app.example.com'] });
  });
  it('authorization server advertises S256 only and public clients', async () => {
    const body = await asm(new Request('https://app.example.com/.well-known/oauth-authorization-server')).json();
    expect(body).toMatchObject({
      issuer: 'https://app.example.com',
      token_endpoint: 'https://app.example.com/api/oauth/token',
      registration_endpoint: 'https://app.example.com/api/oauth/register',
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
    });
  });
  it('404s when OAuth is disabled', () => {
    process.env.OAUTH_DISABLED = 'true';
    expect(prm(new Request('https://x.co/')).status).toBe(404);
    expect(asm(new Request('https://x.co/')).status).toBe(404);
  });
});

describe('POST /api/oauth/register', () => {
  it('registers a client with the Claude callback', async () => {
    store.registerClient.mockResolvedValue({ clientId: 'c1', clientName: 'Claude', redirectUris: [CLAUDE_CALLBACK] });
    const res = await register(json('https://x.co/api/oauth/register', { client_name: 'Claude', redirect_uris: [CLAUDE_CALLBACK] }));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ client_id: 'c1', token_endpoint_auth_method: 'none' });
  });
  it.each([
    [{ redirect_uris: ['https://evil.example.com/cb'] }],
    [{ redirect_uris: [] }],
    [{ redirect_uris: 'nope' }],
    [{}],
  ])('rejects bad redirect_uris %j', async (body) => {
    const res = await register(json('https://x.co/api/oauth/register', body));
    expect(res.status).toBe(400);
    expect(store.registerClient).not.toHaveBeenCalled();
  });
  it('rate limits', async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: Date.now() + 1000, firstBlock: true });
    expect((await register(json('https://x.co/', { redirect_uris: [CLAUDE_CALLBACK] }))).status).toBe(429);
  });
});

describe('POST /api/oauth/token', () => {
  it('exchanges a code (form-encoded) and never caches', async () => {
    store.exchangeAuthCode.mockResolvedValue({ accessToken: 'a', refreshToken: 'r', expiresIn: 3600, scope: 'mcp:read' });
    const res = await token(formReq('https://x.co/api/oauth/token', { grant_type: 'authorization_code', client_id: 'c1', code: 'c', redirect_uri: CLAUDE_CALLBACK, code_verifier: 'v' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({ access_token: 'a', token_type: 'Bearer', expires_in: 3600, refresh_token: 'r', scope: 'mcp:read' });
  });
  it('refreshes', async () => {
    store.refreshTokens.mockResolvedValue({ accessToken: 'a2', refreshToken: 'r2', expiresIn: 3600, scope: 'mcp:read' });
    const res = await token(formReq('https://x.co/api/oauth/token', { grant_type: 'refresh_token', client_id: 'c1', refresh_token: 'r' }));
    expect((await res.json()).access_token).toBe('a2');
  });
  it('returns invalid_grant (400) for a spent token', async () => {
    store.refreshTokens.mockResolvedValue({ error: 'invalid_grant', description: 'used' });
    const res = await token(formReq('https://x.co/api/oauth/token', { grant_type: 'refresh_token', client_id: 'c1', refresh_token: 'r' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_grant' });
  });
  it('rejects missing params and unsupported grants', async () => {
    expect((await token(formReq('https://x.co/', { grant_type: 'authorization_code', client_id: 'c1' }))).status).toBe(400);
    expect((await token(formReq('https://x.co/', { grant_type: 'client_credentials', client_id: 'c1' }))).status).toBe(400);
    expect((await token(formReq('https://x.co/', { grant_type: 'refresh_token' }))).status).toBe(400);
  });
});

describe('POST /api/oauth/authorize (consent)', () => {
  const challenge = createHash('sha256').update('v'.repeat(50)).digest('base64url');
  const base = { client_id: 'c1', redirect_uri: CLAUDE_CALLBACK, code_challenge: challenge, state: 'st', scope: 'mcp:read mcp:write' };
  const tokenFor = (email: string, scope = base.scope) =>
    consentToken({ userEmail: email, clientId: base.client_id, redirectUri: base.redirect_uri, codeChallenge: base.code_challenge, state: base.state, scope });
  const submit = (extra: Record<string, string>, headers: Record<string, string> = {}) =>
    authorize(formReq('https://app.example.com/api/oauth/authorize', { ...base, ...extra }, headers));

  beforeEach(() => {
    store.getClient.mockResolvedValue({ clientId: 'c1', clientName: 'Claude', redirectUris: [CLAUDE_CALLBACK] });
    store.issueAuthCode.mockResolvedValue('CODE');
  });

  it('requires a signed-in user', async () => {
    expect((await submit({ decision: 'allow', consent_token: 'x' })).status).toBe(401);
  });
  it('rejects a forged consent token (CSRF)', async () => {
    session.user = { email: 'u@x.co' };
    expect((await submit({ decision: 'allow', consent_token: 'forged' })).status).toBe(403);
    expect(store.issueAuthCode).not.toHaveBeenCalled();
  });
  it('rejects a token minted for a different user', async () => {
    session.user = { email: 'victim@x.co' };
    expect((await submit({ decision: 'allow', consent_token: tokenFor('attacker@x.co') })).status).toBe(403);
  });
  it('rejects cross-origin posts', async () => {
    session.user = { email: 'u@x.co' };
    const res = await submit({ decision: 'allow', consent_token: tokenFor('u@x.co') }, { Origin: 'https://evil.example.com', Host: 'app.example.com' });
    expect(res.status).toBe(403);
  });
  it('grants read only unless the write box is ticked', async () => {
    session.user = { email: 'u@x.co' };
    const res = await submit({ decision: 'allow', consent_token: tokenFor('u@x.co') });
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe(`${CLAUDE_CALLBACK}?code=CODE&state=st`);
    expect(store.issueAuthCode).toHaveBeenCalledWith({}, expect.objectContaining({ scope: 'mcp:read' }));
  });
  it('grants write when ticked', async () => {
    session.user = { email: 'u@x.co' };
    await submit({ decision: 'allow', allow_write: '1', consent_token: tokenFor('u@x.co') });
    expect(store.issueAuthCode).toHaveBeenCalledWith({}, expect.objectContaining({ scope: 'mcp:read mcp:write' }));
  });
  it('redirects access_denied on deny without issuing a code', async () => {
    session.user = { email: 'u@x.co' };
    const res = await submit({ decision: 'deny', consent_token: tokenFor('u@x.co') });
    expect(res.headers.get('Location')).toBe(`${CLAUDE_CALLBACK}?error=access_denied&state=st`);
    expect(store.issueAuthCode).not.toHaveBeenCalled();
  });
  it('refuses an unregistered redirect_uri even with a valid token', async () => {
    session.user = { email: 'u@x.co' };
    const evil = 'https://evil.example.com/cb';
    const t = consentToken({ userEmail: 'u@x.co', clientId: 'c1', redirectUri: evil, codeChallenge: challenge, state: 'st', scope: base.scope });
    const res = await submit({ decision: 'allow', redirect_uri: evil, consent_token: t });
    expect(res.status).toBe(400);
    expect(store.issueAuthCode).not.toHaveBeenCalled();
  });
});
