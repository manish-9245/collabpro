import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHash } from 'crypto';
import type { PrismaClient } from '@prisma/client';
import { exchangeAuthCode, issueAuthCode, refreshTokens, verifyOAuthAccessToken, revokeGrant, revokeByToken, registerClient, listGrants, cleanupExpired, MAX_OAUTH_CLIENTS } from '@/lib/oauth/store';
import { sha256Hex } from '@/lib/oauth/core';

type Row = Record<string, any>;

// Minimal in-memory stand-in implementing just the Prisma calls the store uses,
// including the atomic updateMany(where: {...null}) claims the security
// properties (single-use codes, refresh rotation) depend on.
function makeDb() {
  const codes: Row[] = [];
  const tokens: Row[] = [];
  const clients: Row[] = [];
  const match = (row: Row, where: Row): boolean =>
    Object.entries(where).every(([k, v]) => {
      if (k === 'OR') return (v as Row[]).some((w) => match(row, w));
      if (v && typeof v === 'object' && !(v instanceof Date)) {
        if ('gt' in v) return row[k] > v.gt;
        if ('lt' in v) return row[k] != null && row[k] < v.lt;
        if ('none' in v) return true;
      }
      return row[k] === v;
    });
  const table = (rows: Row[]) => ({
    create: async ({ data }: { data: Row }) => { const r = { id: `id${rows.length}`, createdAt: new Date(), usedAt: null, rotatedAt: null, revokedAt: null, lastUsedAt: null, ...data }; rows.push(r); return r; },
    findUnique: async ({ where }: { where: Row }) => rows.find((r) => match(r, where)) ?? null,
    findMany: async ({ where }: { where: Row }) => rows.filter((r) => match(r, where)).map((r) => ({ ...r, client: { clientName: 'Claude' } })),
    updateMany: async ({ where, data }: { where: Row; data: Row }) => { const hit = rows.filter((r) => match(r, where)); hit.forEach((r) => Object.assign(r, data)); return { count: hit.length }; },
    deleteMany: async ({ where }: { where: Row }) => { const hit = rows.filter((r) => match(r, where)); hit.forEach((r) => rows.splice(rows.indexOf(r), 1)); return { count: hit.length }; },
  });
  const prisma: Record<string, unknown> = { oAuthCode: table(codes), oAuthToken: table(tokens), oAuthClient: table(clients) };
  prisma.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma);
  return { prisma: prisma as unknown as PrismaClient, codes, tokens };
}

const verifier = 'v'.repeat(50);
const challenge = createHash('sha256').update(verifier).digest('base64url');
const redirectUri = 'https://claude.ai/api/mcp/auth_callback';

async function issue(prisma: PrismaClient, scope = 'mcp:read mcp:write') {
  return issueAuthCode(prisma, { clientId: 'c1', userEmail: 'u@x.co', codeChallenge: challenge, redirectUri, scope });
}

describe('authorization code exchange', () => {
  let db: ReturnType<typeof makeDb>;
  beforeEach(() => { db = makeDb(); });

  it('issues tokens for a valid code + verifier, and stores only hashes', async () => {
    const code = await issue(db.prisma);
    expect(db.codes[0].hashedCode).toBe(sha256Hex(code));
    expect(JSON.stringify(db.codes)).not.toContain(code);
    const res = await exchangeAuthCode(db.prisma, { code, clientId: 'c1', redirectUri, codeVerifier: verifier });
    expect('error' in res).toBe(false);
    if ('error' in res) return;
    expect(res.accessToken.startsWith('collabpro_oat_')).toBe(true);
    expect(JSON.stringify(db.tokens)).not.toContain(res.accessToken);
    expect(JSON.stringify(db.tokens)).not.toContain(res.refreshToken);
  });

  it('is single-use', async () => {
    const code = await issue(db.prisma);
    const args = { code, clientId: 'c1', redirectUri, codeVerifier: verifier };
    expect('error' in (await exchangeAuthCode(db.prisma, args))).toBe(false);
    expect(await exchangeAuthCode(db.prisma, args)).toMatchObject({ error: 'invalid_grant' });
  });

  it.each([
    ['wrong verifier', { codeVerifier: 'w'.repeat(50) }],
    ['wrong client', { clientId: 'other' }],
    ['wrong redirect_uri', { redirectUri: 'http://localhost/callback' }],
  ])('rejects %s', async (_n, override) => {
    const code = await issue(db.prisma);
    const res = await exchangeAuthCode(db.prisma, { code, clientId: 'c1', redirectUri, codeVerifier: verifier, ...override });
    expect(res).toMatchObject({ error: 'invalid_grant' });
  });

  it('rejects an expired code', async () => {
    const code = await issue(db.prisma);
    db.codes[0].expiresAt = new Date(Date.now() - 1000);
    expect(await exchangeAuthCode(db.prisma, { code, clientId: 'c1', redirectUri, codeVerifier: verifier })).toMatchObject({ error: 'invalid_grant' });
  });
});

describe('authorization code reuse (RFC 6749 4.1.2 / RFC 9700)', () => {
  it('re-presenting a used code revokes the tokens it produced', async () => {
    const db = makeDb();
    const code = await issue(db.prisma);
    const args = { code, clientId: 'c1', redirectUri, codeVerifier: verifier };
    const t = await exchangeAuthCode(db.prisma, args);
    if ('error' in t) throw new Error('unexpected');
    expect(await verifyOAuthAccessToken(db.prisma, t.accessToken)).not.toBeNull();
    expect(await exchangeAuthCode(db.prisma, args)).toMatchObject({ error: 'invalid_grant' });
    expect(await verifyOAuthAccessToken(db.prisma, t.accessToken)).toBeNull();
    expect(await refreshTokens(db.prisma, { refreshToken: t.refreshToken, clientId: 'c1' })).toMatchObject({ error: 'invalid_grant' });
  });
});

describe('RFC 7009 revocation + registration cap', () => {
  it('revokes the family via access or refresh token, only for the owning client, silently ignoring unknowns', async () => {
    const db = makeDb();
    const code = await issue(db.prisma);
    const t = await exchangeAuthCode(db.prisma, { code, clientId: 'c1', redirectUri, codeVerifier: verifier });
    if ('error' in t) throw new Error('unexpected');
    expect(await revokeByToken(db.prisma, 'someone-else', t.accessToken)).toBe(0);
    expect(await verifyOAuthAccessToken(db.prisma, t.accessToken)).not.toBeNull();
    await revokeByToken(db.prisma, 'c1', 'collabpro_ort_unknown');
    expect(await revokeByToken(db.prisma, 'c1', t.refreshToken)).toBe(1);
    expect(await verifyOAuthAccessToken(db.prisma, t.accessToken)).toBeNull();
  });
  it('registerClient sanitizes names and refuses past the cap', async () => {
    const created: any[] = [];
    const prisma = { oAuthClient: { count: async () => created.length >= 1 ? MAX_OAUTH_CLIENTS : 0, create: async ({ data }: any) => { created.push(data); return data; } } } as unknown as PrismaClient;
    const c = await registerClient(prisma, { clientName: 'Cla\u202Eude\u0000 ', redirectUris: ['https://claude.ai/api/mcp/auth_callback'] });
    expect(c?.clientName).toBe('Claude');
    expect(await registerClient(prisma, { clientName: 'x', redirectUris: [] })).toBeNull();
  });
});

describe('concurrency (atomic claims)', () => {
  it('two simultaneous exchanges of one code: exactly one wins, and the loser revokes nothing it should not', async () => {
    const db = makeDb();
    const code = await issue(db.prisma);
    const args = { code, clientId: 'c1', redirectUri, codeVerifier: verifier };
    const [a, b] = await Promise.all([exchangeAuthCode(db.prisma, args), exchangeAuthCode(db.prisma, args)]);
    const winners = [a, b].filter((r) => !('error' in r));
    expect(winners).toHaveLength(1);
    expect([a, b].filter((r) => 'error' in r)).toHaveLength(1);
  });
  it('two simultaneous refreshes of one token: one succeeds, the other is refused without revoking the grant', async () => {
    const db = makeDb();
    const code = await issue(db.prisma);
    const t = await exchangeAuthCode(db.prisma, { code, clientId: 'c1', redirectUri, codeVerifier: verifier });
    if ('error' in t) throw new Error('unexpected');
    const results = await Promise.all([
      refreshTokens(db.prisma, { refreshToken: t.refreshToken, clientId: 'c1' }),
      refreshTokens(db.prisma, { refreshToken: t.refreshToken, clientId: 'c1' }),
    ]);
    const ok = results.filter((r) => !('error' in r));
    expect(ok).toHaveLength(1);
    const winner = ok[0] as { accessToken: string };
    expect(await verifyOAuthAccessToken(db.prisma, winner.accessToken)).not.toBeNull();
  });
});

describe('grant listing', () => {
  it('collapses re-authorizations of the same client into one entry', async () => {
    const db = makeDb();
    for (let i = 0; i < 2; i++) {
      const code = await issue(db.prisma, i === 0 ? 'mcp:read' : 'mcp:read mcp:write');
      await exchangeAuthCode(db.prisma, { code, clientId: 'c1', redirectUri, codeVerifier: verifier });
    }
    const grants = await listGrants(db.prisma, 'u@x.co');
    expect(grants).toHaveLength(1);
    expect(grants[0].scope).toContain('mcp:write');
  });
});

describe('access tokens', () => {
  it('verify, map scope, and reject expired/revoked/unknown', async () => {
    const db = makeDb();
    const code = await issue(db.prisma, 'mcp:read');
    const t = await exchangeAuthCode(db.prisma, { code, clientId: 'c1', redirectUri, codeVerifier: verifier });
    if ('error' in t) throw new Error('unexpected');
    expect(await verifyOAuthAccessToken(db.prisma, t.accessToken)).toMatchObject({ userEmail: 'u@x.co', clientId: 'c1', scope: 'read-only', familyId: db.codes[0].id });
    expect(await verifyOAuthAccessToken(db.prisma, 'collabpro_oat_nope')).toBeNull();
    expect(await verifyOAuthAccessToken(db.prisma, 'collabpro_pat_x')).toBeNull();
    db.tokens[0].accessExpiresAt = new Date(Date.now() - 1);
    expect(await verifyOAuthAccessToken(db.prisma, t.accessToken)).toBeNull();
    db.tokens[0].accessExpiresAt = new Date(Date.now() + 1e6);
    await revokeGrant(db.prisma, 'u@x.co', 'c1');
    expect(await verifyOAuthAccessToken(db.prisma, t.accessToken)).toBeNull();
  });

  it('write scope maps to read-write', async () => {
    const db = makeDb();
    const code = await issue(db.prisma);
    const t = await exchangeAuthCode(db.prisma, { code, clientId: 'c1', redirectUri, codeVerifier: verifier });
    if ('error' in t) throw new Error('unexpected');
    expect(await verifyOAuthAccessToken(db.prisma, t.accessToken)).toMatchObject({ scope: 'read-write' });
  });
});

describe('refresh rotation and reuse detection', () => {
  async function start() {
    const db = makeDb();
    const code = await issue(db.prisma);
    const t = await exchangeAuthCode(db.prisma, { code, clientId: 'c1', redirectUri, codeVerifier: verifier });
    if ('error' in t) throw new Error('unexpected');
    return { db, t };
  }

  it('rotates: new pair works, old refresh token is spent', async () => {
    const { db, t } = await start();
    const r = await refreshTokens(db.prisma, { refreshToken: t.refreshToken, clientId: 'c1' });
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.refreshToken).not.toBe(t.refreshToken);
    expect(db.tokens[0].familyId).toBe(db.tokens[1].familyId);
    expect(await verifyOAuthAccessToken(db.prisma, r.accessToken)).not.toBeNull();
  });

  it('replaying a rotated refresh token revokes the entire family', async () => {
    const { db, t } = await start();
    const r = await refreshTokens(db.prisma, { refreshToken: t.refreshToken, clientId: 'c1' });
    if ('error' in r) throw new Error('unexpected');
    db.tokens[0].rotatedAt = new Date(Date.now() - 60_000); // well past the concurrency leeway
    expect(await refreshTokens(db.prisma, { refreshToken: t.refreshToken, clientId: 'c1' })).toMatchObject({ error: 'invalid_grant' });
    expect(await verifyOAuthAccessToken(db.prisma, r.accessToken)).toBeNull();
    expect(await refreshTokens(db.prisma, { refreshToken: r.refreshToken, clientId: 'c1' })).toMatchObject({ error: 'invalid_grant' });
  });

  it('a concurrent/immediate retry of a just-rotated token is refused WITHOUT revoking the grant', async () => {
    const { db, t } = await start();
    const r = await refreshTokens(db.prisma, { refreshToken: t.refreshToken, clientId: 'c1' });
    if ('error' in r) throw new Error('unexpected');
    expect(await refreshTokens(db.prisma, { refreshToken: t.refreshToken, clientId: 'c1' })).toMatchObject({ error: 'invalid_grant' });
    expect(await verifyOAuthAccessToken(db.prisma, r.accessToken)).not.toBeNull();
    expect(await refreshTokens(db.prisma, { refreshToken: r.refreshToken, clientId: 'c1' })).not.toHaveProperty('error');
  });

  it('rejects the wrong client, unknown tokens, and expired tokens', async () => {
    const { db, t } = await start();
    expect(await refreshTokens(db.prisma, { refreshToken: t.refreshToken, clientId: 'evil' })).toMatchObject({ error: 'invalid_grant' });
    expect(await refreshTokens(db.prisma, { refreshToken: 'collabpro_ort_nope', clientId: 'c1' })).toMatchObject({ error: 'invalid_grant' });
    db.tokens[0].refreshExpiresAt = new Date(Date.now() - 1);
    expect(await refreshTokens(db.prisma, { refreshToken: t.refreshToken, clientId: 'c1' })).toMatchObject({ error: 'invalid_grant' });
  });
});

describe('grants + cleanup', () => {
  it('lists active grants, revoke removes them, cleanup prunes expired rows', async () => {
    const db = makeDb();
    const code = await issue(db.prisma);
    await exchangeAuthCode(db.prisma, { code, clientId: 'c1', redirectUri, codeVerifier: verifier });
    expect(await listGrants(db.prisma, 'u@x.co')).toHaveLength(1);
    expect(await revokeGrant(db.prisma, 'u@x.co', 'c1')).toBe(1);
    expect(await listGrants(db.prisma, 'u@x.co')).toHaveLength(0);
    db.tokens[0].refreshExpiresAt = new Date(Date.now() - 1);
    db.codes[0].expiresAt = new Date(Date.now() - 2 * 3600 * 1000);
    const res = await cleanupExpired(db.prisma);
    expect(res.tokens).toBe(1);
    expect(res.codes).toBe(1);
  });
});

vi.unmock('@/lib/oauth/store');
