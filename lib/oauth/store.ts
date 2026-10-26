import type { PrismaClient } from '@prisma/client';
import {
  ACCESS_TOKEN_PREFIX, ACCESS_TOKEN_TTL_MS, AUTH_CODE_TTL_MS, REFRESH_TOKEN_PREFIX, REFRESH_TOKEN_TTL_MS,
  randomId, randomToken, sha256Hex, verifyPkceS256, redirectUriMatches, toApiScope,
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

const MAX_CLIENT_NAME = 100;
const MAX_REDIRECT_URIS = 5;

export async function registerClient(
  prisma: PrismaClient,
  input: { clientName: string; redirectUris: string[] },
) {
  const clientId = `collabpro_client_${randomId()}`;
  const client = await prisma.oAuthClient.create({
    data: {
      clientId,
      clientName: input.clientName.slice(0, MAX_CLIENT_NAME) || 'MCP client',
      redirectUris: input.redirectUris.slice(0, MAX_REDIRECT_URIS),
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

export async function exchangeAuthCode(
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
  if (claimed.count !== 1) return { error: 'invalid_grant', description: 'Authorization code is invalid, expired, or already used' };

  const row = await prisma.oAuthCode.findUnique({ where: { hashedCode } });
  if (!row) return { error: 'invalid_grant', description: 'Authorization code is invalid' };
  if (row.clientId !== input.clientId) return { error: 'invalid_grant', description: 'Code was not issued to this client' };
  if (row.redirectUri !== input.redirectUri) return { error: 'invalid_grant', description: 'redirect_uri does not match the authorization request' };
  if (!verifyPkceS256(input.codeVerifier, row.codeChallenge)) return { error: 'invalid_grant', description: 'PKCE verification failed' };

  return mintTokens(prisma, { familyId: randomId(), clientId: row.clientId, userEmail: row.userEmail, scope: row.scope });
}

export async function refreshTokens(
  prisma: PrismaClient,
  input: { refreshToken: string; clientId: string },
): Promise<IssuedTokens | OAuthError> {
  const hashedRefresh = sha256Hex(input.refreshToken);
  const row = await prisma.oAuthToken.findUnique({ where: { hashedRefresh } });
  if (!row || row.clientId !== input.clientId) return { error: 'invalid_grant', description: 'Refresh token is invalid' };
  if (row.revokedAt || row.refreshExpiresAt <= new Date()) return { error: 'invalid_grant', description: 'Refresh token is expired or revoked' };

  // Atomic claim of the rotation; losing the race (or presenting an already
  // rotated token) is treated as replay and burns the whole family.
  const claimed = row.rotatedAt
    ? { count: 0 }
    : await prisma.oAuthToken.updateMany({ where: { id: row.id, rotatedAt: null, revokedAt: null }, data: { rotatedAt: new Date() } });
  if (claimed.count !== 1) {
    await prisma.oAuthToken.updateMany({ where: { familyId: row.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
    return { error: 'invalid_grant', description: 'Refresh token was already used; the grant has been revoked' };
  }
  return mintTokens(prisma, { familyId: row.familyId, clientId: row.clientId, userEmail: row.userEmail, scope: row.scope });
}

export interface VerifiedOAuthToken {
  id: string;
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
  return { id: row.id, userEmail: row.userEmail, clientId: row.clientId, scope: toApiScope(row.scope) };
}

export async function listGrants(prisma: PrismaClient, userEmail: string) {
  const rows = await prisma.oAuthToken.findMany({
    where: { userEmail, revokedAt: null, rotatedAt: null, refreshExpiresAt: { gt: new Date() } },
    include: { client: { select: { clientName: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((r) => ({
    clientId: r.clientId,
    clientName: r.client.clientName,
    scope: r.scope,
    connectedAt: r.createdAt,
    lastUsedAt: r.lastUsedAt,
  }));
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

export { redirectUriMatches };
