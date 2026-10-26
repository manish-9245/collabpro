import { describe, it, expect, beforeEach, beforeAll, afterEach, vi } from 'vitest';
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
  revokeByToken: vi.fn().mockResolvedValue(0),
}));
vi.mock('@/lib/oauth/store', () => ({ ...store, MAX_REDIRECT_URIS: 5 }));
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
import { POST as revoke } from '@/app/api/oauth/revoke/route';
import { DELETE as deleteGrant } from '@/app/api/oauth/grants/route';
import { GET as prm } from '@/app/.well-known/oauth-protected-resource/[[...path]]/route';
import { GET as asm } from '@/app/.well-known/oauth-authorization-server/route';
import { consentToken, CLAUDE_CALLBACK } from '@/lib/oauth/core';
import { checkRateLimit } from '@/lib/rate-limiter';
import { logAuditEvent } from '@/lib/audit';
import { POST as cleanup } from '@/app/api/internal/oauth-cleanup/route';

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
    const verifier = 'v'.repeat(50);
    const res = await token(formReq('https://x.co/api/oauth/token', { grant_type: 'authorization_code', client_id: 'c1', code: 'c', redirect_uri: CLAUDE_CALLBACK, code_verifier: verifier }));
    expect(res.status).toBe(200);
    expect(store.exchangeAuthCode).toHaveBeenCalledWith({}, { code: 'c', clientId: 'c1', redirectUri: CLAUDE_CALLBACK, codeVerifier: verifier });
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
  const submit = (extra: Record<string, string>, headers: Record<string, string> = { Origin: 'https://app.example.com' }) =>
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
  it('rejects posts with no Origin and no same-origin Sec-Fetch-Site; accepts the latter', async () => {
    session.user = { email: 'u@x.co' };
    const t = tokenFor('u@x.co');
    expect((await submit({ decision: 'allow', consent_token: t }, {})).status).toBe(403);
    expect((await submit({ decision: 'allow', consent_token: t }, { 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403);
    expect((await submit({ decision: 'allow', consent_token: t }, { 'Sec-Fetch-Site': 'same-origin' })).status).toBe(303);
  });
  it('rejects a consent token older than 10 minutes', async () => {
    session.user = { email: 'u@x.co' };
    const old = consentToken({ userEmail: 'u@x.co', clientId: base.client_id, redirectUri: base.redirect_uri, codeChallenge: base.code_challenge, state: base.state, scope: base.scope }, Date.now() - 11 * 60 * 1000);
    expect((await submit({ decision: 'allow', consent_token: old })).status).toBe(403);
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
    expect(res.headers.get('Location')).toBe(`${CLAUDE_CALLBACK}?code=CODE&state=st&iss=https%3A%2F%2Fapp.example.com`);
    expect(store.issueAuthCode).toHaveBeenCalledWith({}, { clientId: 'c1', userEmail: 'u@x.co', codeChallenge: challenge, redirectUri: CLAUDE_CALLBACK, scope: 'mcp:read' });
  });
  it('grants write when ticked', async () => {
    session.user = { email: 'u@x.co' };
    await submit({ decision: 'allow', allow_write: '1', consent_token: tokenFor('u@x.co') });
    expect(store.issueAuthCode).toHaveBeenCalledWith({}, { clientId: 'c1', userEmail: 'u@x.co', codeChallenge: challenge, redirectUri: CLAUDE_CALLBACK, scope: 'mcp:read mcp:write' });
  });
  it('redirects access_denied on deny without issuing a code', async () => {
    session.user = { email: 'u@x.co' };
    const res = await submit({ decision: 'deny', consent_token: tokenFor('u@x.co') });
    expect(res.headers.get('Location')).toBe(`${CLAUDE_CALLBACK}?error=access_denied&state=st&iss=https%3A%2F%2Fapp.example.com`);
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


describe('token endpoint input hardening', () => {
  const url = 'https://x.co/api/oauth/token';
  it('requires form content-type', async () => {
    const res = await token(new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }));
    expect(res.status).toBe(400);
  });
  it('rejects repeated parameters (RFC 6749 3.2)', async () => {
    const res = await token(new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=refresh_token&client_id=c1&refresh_token=a&refresh_token=b' }));
    expect(res.status).toBe(400);
    expect(store.refreshTokens).not.toHaveBeenCalled();
  });
  it('rejects oversized bodies', async () => {
    const res = await token(formReq(url, { grant_type: 'refresh_token', client_id: 'c1', refresh_token: 'x'.repeat(9000) }));
    expect(res.status).toBe(413);
  });
  it('treats an EMPTY resource as present-and-wrong (not as absent)', async () => {
    const res = await token(formReq(url, { grant_type: 'refresh_token', client_id: 'c1', refresh_token: 'r', resource: '' }));
    expect(await res.json()).toMatchObject({ error: 'invalid_target' });
  });
  it('enforces RFC 8707 resource: wrong audience -> invalid_target, right one passes', async () => {
    const bad = await token(formReq(url, { grant_type: 'refresh_token', client_id: 'c1', refresh_token: 'r', resource: 'https://other.example.com/api/mcp' }));
    expect(await bad.json()).toMatchObject({ error: 'invalid_target' });
    store.refreshTokens.mockResolvedValue({ accessToken: 'a', refreshToken: 'r2', expiresIn: 1, scope: 'mcp:read' });
    const good = await token(formReq(url, { grant_type: 'refresh_token', client_id: 'c1', refresh_token: 'r', resource: 'https://x.co/api/mcp' }));
    expect(good.status).toBe(200);
  });
});

describe('register endpoint input hardening', () => {
  it('requires a JSON content-type and caps body size', async () => {
    expect((await register(new Request('https://x.co/', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' }))).status).toBe(400);
    expect((await register(json('https://x.co/', { redirect_uris: [CLAUDE_CALLBACK], client_name: 'x'.repeat(9000) }))).status).toBe(413);
  });
  it('answers 503 when the client table is full', async () => {
    store.registerClient.mockResolvedValue(null);
    expect((await register(json('https://x.co/', { redirect_uris: [CLAUDE_CALLBACK] }))).status).toBe(503);
  });
});

describe('metadata caching (cache-poisoning defense)', () => {
  afterEach(() => { delete process.env.APP_URL; });
  it('is no-store when the origin is derived from forwarded headers', () => {
    delete process.env.APP_URL;
    const res = asm(new Request('http://internal/x', { headers: { 'x-forwarded-host': 'evil.example.com', 'x-forwarded-proto': 'https' } }));
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
  it('is publicly cacheable only when APP_URL pins the origin, and then ignores forged headers', async () => {
    process.env.APP_URL = 'https://app.example.com';
    const res = asm(new Request('http://internal/x', { headers: { 'x-forwarded-host': 'evil.example.com' } }));
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=300');
    expect((await res.json()).issuer).toBe('https://app.example.com');
    delete process.env.APP_URL;
  });
  it('advertises revocation and RFC 9207 iss support', async () => {
    const body = await asm(new Request('https://app.example.com/x')).json();
    expect(body.revocation_endpoint).toBe('https://app.example.com/api/oauth/revoke');
    expect(body.authorization_response_iss_parameter_supported).toBe(true);
    expect(body.revocation_endpoint_auth_methods_supported).toEqual(['none']);
  });
});


describe('POST /api/oauth/revoke (RFC 7009)', () => {
  const url = 'https://x.co/api/oauth/revoke';
  it('always answers 200 for a well-formed request and revokes via the store', async () => {
    const res = await revoke(formReq(url, { token: 'collabpro_ort_whatever', client_id: 'c1' }));
    expect(res.status).toBe(200);
    expect(store.revokeByToken).toHaveBeenCalledWith({}, 'c1', 'collabpro_ort_whatever');
  });
  it('rejects missing params and wrong content-type', async () => {
    expect((await revoke(formReq(url, { client_id: 'c1' }))).status).toBe(400);
    expect((await revoke(new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }))).status).toBe(400);
  });
});

describe('DELETE /api/oauth/grants', () => {
  const url = 'https://app.example.com/api/oauth/grants?clientId=c1';
  it('requires a session, a same-origin request, and revokes only for that user', async () => {
    expect((await deleteGrant(new Request(url, { method: 'DELETE', headers: { Origin: 'https://app.example.com' } }))).status).toBe(401);
    session.user = { email: 'u@x.co' };
    expect((await deleteGrant(new Request(url, { method: 'DELETE', headers: { Origin: 'https://evil.example.com' } }))).status).toBe(403);
    store.revokeGrant.mockResolvedValue(2);
    const ok = await deleteGrant(new Request(url, { method: 'DELETE', headers: { Origin: 'https://app.example.com' } }));
    expect(ok.status).toBe(200);
    expect(store.revokeGrant).toHaveBeenCalledWith({}, 'u@x.co', 'c1');
  });
});


describe('exact media types', () => {
  it('rejects look-alike content types on token, revoke and register', async () => {
    const lookalike = { 'Content-Type': 'application/x-www-form-urlencoded-evil' };
    expect((await token(new Request('https://x.co/t', { method: 'POST', headers: lookalike, body: 'grant_type=refresh_token&client_id=c&refresh_token=r' }))).status).toBe(400);
    expect((await revoke(new Request('https://x.co/r', { method: 'POST', headers: lookalike, body: 'token=t&client_id=c' }))).status).toBe(400);
    expect((await register(new Request('https://x.co/g', { method: 'POST', headers: { 'Content-Type': 'application/json-malformed' }, body: '{}' }))).status).toBe(400);
  });
  it('accepts a charset parameter', async () => {
    store.refreshTokens.mockResolvedValue({ accessToken: 'a', refreshToken: 'r', expiresIn: 1, scope: 'mcp:read' });
    const res = await token(new Request('https://x.co/t', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' }, body: 'grant_type=refresh_token&client_id=c&refresh_token=r' }));
    expect(res.status).toBe(200);
  });
});

describe('register: redirect_uris bounds and body shape', () => {
  it('rejects more than 5 URIs (no silent truncation) and over-long URIs', async () => {
    const six = Array.from({ length: 6 }, () => CLAUDE_CALLBACK);
    expect((await register(json('https://x.co/', { redirect_uris: six }))).status).toBe(400);
    expect((await register(json('https://x.co/', { redirect_uris: [`${CLAUDE_CALLBACK}?${'a'.repeat(600)}`] }))).status).toBe(400);
    expect(store.registerClient).not.toHaveBeenCalled();
  });
  it('a JSON null / array body is a 400, not a crash', async () => {
    expect((await register(json('https://x.co/', null))).status).toBe(400);
    expect((await register(json('https://x.co/', []))).status).toBe(400);
  });
});

describe('revoke audit + stream failure', () => {
  it('audits only when something was actually revoked', async () => {
    store.revokeByToken.mockResolvedValueOnce(0);
    await revoke(formReq('https://x.co/api/oauth/revoke', { token: 't', client_id: 'c1' }));
    expect(logAuditEvent).not.toHaveBeenCalled();
    store.revokeByToken.mockResolvedValueOnce(2);
    await revoke(formReq('https://x.co/api/oauth/revoke', { token: 't', client_id: 'c1' }));
    expect(logAuditEvent).toHaveBeenCalledWith(null, 'unknown', 'oauth:token:revoked', { clientId: 'c1', tokens: 2 }, '203.0.113.9');
  });
  it('a body stream that errors mid-upload is a clean 413/400, not a 500', async () => {
    const body = new ReadableStream({ start(c) { c.error(new Error('client went away')); } });
    const req = new Request('https://x.co/t', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, duplex: 'half' } as RequestInit);
    const res = await token(req);
    expect([400, 413]).toContain(res.status);
  });
});

describe('cleanup endpoint (cron) fails closed', () => {
  afterEach(() => { delete process.env.CRON_SECRET; });
  it('is 404 without CRON_SECRET, 401 with a wrong secret, 200 with the right one', async () => {
    expect((await cleanup(new Request('https://x.co/c', { method: 'POST' }))).status).toBe(404);
    process.env.CRON_SECRET = 'cron-secret';
    expect((await cleanup(new Request('https://x.co/c', { method: 'POST', headers: { Authorization: 'Bearer nope' } }))).status).toBe(401);
    expect((await cleanup(new Request('https://x.co/c', { method: 'POST' }))).status).toBe(401);
    store.cleanupExpired.mockResolvedValue({ codes: 1, tokens: 2, clients: 3 });
    const ok = await cleanup(new Request('https://x.co/c', { method: 'POST', headers: { Authorization: 'Bearer cron-secret' } }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ codes: 1, tokens: 2, clients: 3 });
  });
});
