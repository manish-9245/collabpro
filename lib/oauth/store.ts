import type { PrismaClient } from '@prisma/client';
import {
  ACCESS_TOKEN_PREFIX, ACCESS_TOKEN_TTL_MS, AUTH_CODE_TTL_MS, REFRESH_TOKEN_PREFIX, REFRESH_TOKEN_TTL_MS,
  randomId, randomToken, sha256Hex, verifyPkceS256, sanitizeClientName, toApiScope,
} from '@/lib/oauth/core';

/**
 * Persistence + state machine for the OAuth server. Every secret is looked up
 * by its SHA-256 hash; raw values are returned to the caller exactly once.
 */

export type OAuthError = { error: 'invalid_grant' | 'invalid_request' | 'invalid_client'; description: string };
export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string;
}

export const MAX_REDIRECT_URIS = 5;
/** Concurrent refreshes (two requests racing on the same token) must not look like theft. */
const REFRESH_REUSE_LEEWAY_MS = 10_000;
/**
 * Soft ceiling on stored dynamic clients so open registration cannot fill the
 * table. It is a count-then-insert, so a burst can overshoot by roughly the
 * number of concurrent registrations; the per-IP rate limit and the 24 h prune
 * bound that overshoot, which is all this guard is for.
 */
export const MAX_OAUTH_CLIENTS = 20_000;

export async function registerClient(
  prisma: PrismaClient,
  input: { clientName: string; redirectUris: string[] },
) {
  if ((await prisma.oAuthClient.count()) >= MAX_OAUTH_CLIENTS) return null;
  const clientId = `collabpro_client_${randomId()}`;
  const client = await prisma.oAuthClient.create({
    data: {
      clientId,
      clientName: sanitizeClientName(input.clientName),
      redirectUris: input.redirectUris,
    },
  });
  return client;
}

export function getClient(prisma: PrismaClient, clientId: string) {
  return prisma.oAuthClient.findUnique({ where: { clientId } });
}

export async function issueAuthCode(
  prisma: PrismaClient,
  input: { clientId: string; userEmail: string; codeChallenge: string; redirectUri: string; scope: string },
): Promise<string> {
  const code = randomToken('collabpro_code_');
  await prisma.oAuthCode.create({
    data: {
      hashedCode: sha256Hex(code),
      clientId: input.clientId,
      userEmail: input.userEmail,
      codeChallenge: input.codeChallenge,
      redirectUri: input.redirectUri,
      scope: input.scope,
      expiresAt: new Date(Date.now() + AUTH_CODE_TTL_MS),
    },
  });
  return code;
}

async function mintTokens(
  prisma: PrismaClient,
  input: { familyId: string; clientId: string; userEmail: string; scope: string },
): Promise<IssuedTokens> {
  const accessToken = randomToken(ACCESS_TOKEN_PREFIX);
  const refreshToken = randomToken(REFRESH_TOKEN_PREFIX);
  const now = Date.now();
  await prisma.oAuthToken.create({
    data: {
      familyId: input.familyId,
      hashedAccess: sha256Hex(accessToken),
      hashedRefresh: sha256Hex(refreshToken),
      clientId: input.clientId,
      userEmail: input.userEmail,
      scope: input.scope,
      accessExpiresAt: new Date(now + ACCESS_TOKEN_TTL_MS),
      refreshExpiresAt: new Date(now + REFRESH_TOKEN_TTL_MS),
    },
  });
  return { accessToken, refreshToken, expiresIn: Math.floor(ACCESS_TOKEN_TTL_MS / 1000), scope: input.scope };
}

/**
 * Claim + validate + mint run in ONE transaction. Postgres row locks make a
 * concurrent replay of the same code block on the claim until this commits, so
 * by the time it sees `usedAt` set the minted tokens already exist and its
 * family revocation actually reaches them (no window where a replay revokes
 * zero rows and the first request then issues a live token).
 */
export function exchangeAuthCode(
  prisma: PrismaClient,
  input: { code: string; clientId: string; redirectUri: string; codeVerifier: string },
): Promise<IssuedTokens | OAuthError> {
  return prisma.$transaction((tx) => exchangeAuthCodeTx(tx as unknown as PrismaClient, input));
}

async function exchangeAuthCodeTx(
  prisma: PrismaClient,
  input: { code: string; clientId: string; redirectUri: string; codeVerifier: string },
): Promise<IssuedTokens | OAuthError> {
  const hashedCode = sha256Hex(input.code);
  // Atomic claim: only one concurrent request can flip usedAt from null, so a
  // code can never be exchanged twice.
  const claimed = await prisma.oAuthCode.updateMany({
    where: { hashedCode, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });
  if (claimed.count !== 1) {
    // RFC 6749 4.1.2 / RFC 9700: a code presented again means it may have been
    // stolen - revoke every token that was minted from it.
    const seen = await prisma.oAuthCode.findUnique({ where: { hashedCode } });
    if (seen?.usedAt) {
      await prisma.oAuthToken.updateMany({ where: { familyId: seen.id, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    return { error: 'invalid_grant', description: 'Authorization code is invalid, expired, or already used' };
  }

  const row = await prisma.oAuthCode.findUnique({ where: { hashedCode } });
  if (!row) return { error: 'invalid_grant', description: 'Authorization code is invalid' };
  if (row.clientId !== input.clientId) return { error: 'invalid_grant', description: 'Code was not issued to this client' };
  if (row.redirectUri !== input.redirectUri) return { error: 'invalid_grant', description: 'redirect_uri does not match the authorization request' };
  if (!verifyPkceS256(input.codeVerifier, row.codeChallenge)) return { error: 'invalid_grant', description: 'PKCE verification failed' };

  // The token family is keyed by the code's id, which is what lets a replayed
  // code find and revoke the tokens it produced.
  return mintTokens(prisma, { familyId: row.id, clientId: row.clientId, userEmail: row.userEmail, scope: row.scope });
}

/** Rotation (claim old + insert new) is atomic: a crash can never leave a claimed token with no successor. */
export function refreshTokens(
  prisma: PrismaClient,
  input: { refreshToken: string; clientId: string },
): Promise<IssuedTokens | OAuthError> {
  return prisma.$transaction((tx) => refreshTokensTx(tx as unknown as PrismaClient, input));
}

async function refreshTokensTx(
  prisma: PrismaClient,
  input: { refreshToken: string; clientId: string },
): Promise<IssuedTokens | OAuthError> {
  const hashedRefresh = sha256Hex(input.refreshToken);
  const row = await prisma.oAuthToken.findUnique({ where: { hashedRefresh } });
  if (!row || row.clientId !== input.clientId) return { error: 'invalid_grant', description: 'Refresh token is invalid' };
  if (row.revokedAt || row.refreshExpiresAt <= new Date()) return { error: 'invalid_grant', description: 'Refresh token is expired or revoked' };

  // Atomic claim of the rotation. A token that was already rotated long ago
  // is replay (theft signal): burn the whole family. One rotated moments ago,
  // or a lost race on the claim itself, is a legitimate concurrent refresh:
  // refuse it but leave the grant alone.
  if (row.rotatedAt) {
    if (Date.now() - row.rotatedAt.getTime() > REFRESH_REUSE_LEEWAY_MS) {
      await prisma.oAuthToken.updateMany({ where: { familyId: row.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
      return { error: 'invalid_grant', description: 'Refresh token was already used; the grant has been revoked' };
    }
    return { error: 'invalid_grant', description: 'Refresh token was just used; retry with the newer token' };
  }
  const claimed = await prisma.oAuthToken.updateMany({ where: { id: row.id, rotatedAt: null, revokedAt: null }, data: { rotatedAt: new Date() } });
  if (claimed.count !== 1) return { error: 'invalid_grant', description: 'Refresh token was just used; retry with the newer token' };
  return mintTokens(prisma, { familyId: row.familyId, clientId: row.clientId, userEmail: row.userEmail, scope: row.scope });
}

export interface VerifiedOAuthToken {
  id: string;
  /** Stable across refresh rotation - the right key for per-grant rate limiting. */
  familyId: string;
  userEmail: string;
  clientId: string;
  /** API-key vocabulary ('read-only' | 'read-write') so tools.ts enforcement is unchanged. */
  scope: 'read-only' | 'read-write';
}

const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export async function verifyOAuthAccessToken(prisma: PrismaClient, token: string): Promise<VerifiedOAuthToken | null> {
  if (!token.startsWith(ACCESS_TOKEN_PREFIX)) return null;
  const row = await prisma.oAuthToken.findUnique({ where: { hashedAccess: sha256Hex(token) } });
  if (!row || row.revokedAt || row.accessExpiresAt <= new Date()) return null;
  // Best-effort, throttled: keeps "last used" fresh without a write per call.
  void prisma.oAuthToken
    .updateMany({
      where: { id: row.id, OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: new Date(Date.now() - TOUCH_INTERVAL_MS) } }] },
      data: { lastUsedAt: new Date() },
    })
    .catch(() => {});
  return { id: row.id, familyId: row.familyId, userEmail: row.userEmail, clientId: row.clientId, scope: toApiScope(row.scope) };
}

export async function listGrants(prisma: PrismaClient, userEmail: string) {
  const rows = await prisma.oAuthToken.findMany({
    where: { userEmail, revokedAt: null, rotatedAt: null, refreshExpiresAt: { gt: new Date() } },
    include: { client: { select: { clientName: true } } },
    orderBy: { createdAt: 'desc' },
  });
  // One entry per client: re-authorizing the same app creates a new token
  // family, but the user thinks of it (and revokes it) as one connected app.
  const byClient = new Map<string, { clientId: string; clientName: string; scope: string; connectedAt: Date; lastUsedAt: Date | null }>();
  for (const r of rows) {
    const existing = byClient.get(r.clientId);
    if (!existing) {
      byClient.set(r.clientId, { clientId: r.clientId, clientName: r.client.clientName, scope: r.scope, connectedAt: r.createdAt, lastUsedAt: r.lastUsedAt });
      continue;
    }
    if (r.scope.includes('mcp:write')) existing.scope = r.scope;
    if (r.lastUsedAt && (!existing.lastUsedAt || r.lastUsedAt > existing.lastUsedAt)) existing.lastUsedAt = r.lastUsedAt;
    if (r.createdAt < existing.connectedAt) existing.connectedAt = r.createdAt;
  }
  return [...byClient.values()];
}

/**
 * RFC 7009 revocation. Matches either token type for the given client and
 * revokes the whole family; unknown tokens are silently ignored (the endpoint
 * always answers 200 so it cannot be used to probe for valid tokens).
 */
export async function revokeByToken(prisma: PrismaClient, clientId: string, token: string): Promise<number> {
  const hashed = sha256Hex(token);
  const row = await prisma.oAuthToken.findUnique({ where: { hashedAccess: hashed } })
    ?? await prisma.oAuthToken.findUnique({ where: { hashedRefresh: hashed } });
  if (row?.clientId !== clientId) return 0;
  const res = await prisma.oAuthToken.updateMany({ where: { familyId: row.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
  return res.count;
}

export async function revokeGrant(prisma: PrismaClient, userEmail: string, clientId: string): Promise<number> {
  const res = await prisma.oAuthToken.updateMany({ where: { userEmail, clientId, revokedAt: null }, data: { revokedAt: new Date() } });
  return res.count;
}

/** Housekeeping for rows nothing can use anymore. Safe to run repeatedly. */
export async function cleanupExpired(prisma: PrismaClient): Promise<{ codes: number; tokens: number; clients: number }> {
  const now = Date.now();
  const [codes, tokens] = await Promise.all([
    prisma.oAuthCode.deleteMany({ where: { expiresAt: { lt: new Date(now - 60 * 60 * 1000) } } }),
    prisma.oAuthToken.deleteMany({ where: { OR: [{ refreshExpiresAt: { lt: new Date(now) } }, { revokedAt: { lt: new Date(now - 7 * 24 * 60 * 60 * 1000) } }] } }),
  ]);
  // DCR is open by design, so abandoned registrations are pruned.
  const clients = await prisma.oAuthClient.deleteMany({
    where: { createdAt: { lt: new Date(now - 24 * 60 * 60 * 1000) }, tokens: { none: {} }, codes: { none: {} } },
  });
  return { codes: codes.count, tokens: tokens.count, clients: clients.count };
}

