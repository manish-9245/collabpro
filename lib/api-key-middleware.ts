import { prisma } from '@/lib/db';
import { createHash } from 'crypto';
import { ACCESS_TOKEN_PREFIX } from '@/lib/oauth/core';
import { verifyOAuthAccessToken } from '@/lib/oauth/store';

export interface ApiKeyVerificationResult {
  isValid: boolean;
  userEmail: string | null;
  scope: string | null;
  apiKeyId?: string | null;
  /** Set when the caller authenticated with an OAuth access token (Claude connector). */
  oauthClientId?: string;
  error?: string;
  statusCode?: number;
}

/**
 * Hash a plain text API Key with SHA-256 for secure DB comparison
 */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * True for RPC-style path/tool names that only read data (e.g. `files:getFiles`,
 * `user:searchUsers`) - everything else is treated as a write for scope
 * enforcement purposes. Every caller of `verifyApiKey` (state-sync, MCP) is a
 * POST-only RPC endpoint, so the HTTP method itself carries no read/write
 * signal - classifying by the action name is the only thing that actually
 * distinguishes them.
 */
export function isReadOnlyOperation(path: string): boolean {
  const action = path.includes(':') ? path.split(':')[1] : path;
  return /^(get|search)/.test(action || '');
}

/**
 * Verify an authorization header containing a CollabPro PAT and return verification details
 */
export async function verifyApiKey(
  authorizationHeader: string | null,
  isWriteOperation?: boolean,
  options: { allowOAuth?: boolean } = {}
): Promise<ApiKeyVerificationResult> {
  if (!authorizationHeader) {
    return {
      isValid: false,
      userEmail: null,
      scope: null,
      error: 'Authorization header missing',
      statusCode: 401
    };
  }

  const parts = authorizationHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return {
      isValid: false,
      userEmail: null,
      scope: null,
      error: 'Invalid authorization format. Expected "Bearer <token>"',
      statusCode: 401
    };
  }

  const token = parts[1].trim();

  // OAuth access tokens are audience-bound to the MCP endpoint: only callers
  // that opt in (app/api/mcp/route.ts) accept them, so a connector token can
  // never authenticate state-sync or any other API-key-gated route.
  if (token.startsWith(ACCESS_TOKEN_PREFIX)) {
    if (!options.allowOAuth || process.env.OAUTH_DISABLED === 'true') {
      return { isValid: false, userEmail: null, scope: null, error: 'OAuth tokens are not accepted on this endpoint', statusCode: 401 };
    }
    const oauth = await verifyOAuthAccessToken(prisma, token);
    if (!oauth) {
      return { isValid: false, userEmail: null, scope: null, error: 'Invalid or expired access token', statusCode: 401 };
    }
    if (isWriteOperation && oauth.scope === 'read-only') {
      return { isValid: false, userEmail: oauth.userEmail, scope: oauth.scope, error: 'Forbidden: token has read-only access scope', statusCode: 403 };
    }
    return { isValid: true, userEmail: oauth.userEmail, scope: oauth.scope, apiKeyId: `oauth:${oauth.id}`, oauthClientId: oauth.clientId };
  }

  if (!token.startsWith('collabpro_pat_')) {
    return {
      isValid: false,
      userEmail: null,
      scope: null,
      error: 'Invalid API key prefix',
      statusCode: 401
    };
  }

  const hashedToken = hashApiKey(token);

  const apiKeyRecord = await prisma.apiKey.findUnique({
    where: { hashedKey: hashedToken }
  });

  if (!apiKeyRecord) {
    return {
      isValid: false,
      userEmail: null,
      scope: null,
      error: 'Invalid API key or token has been revoked',
      statusCode: 401
    };
  }

  // Check Expiry
  if (apiKeyRecord.expiresAt && apiKeyRecord.expiresAt < new Date()) {
    return {
      isValid: false,
      userEmail: null,
      scope: null,
      error: 'API key has expired',
      statusCode: 401
    };
  }

  // Check Scope
  if (isWriteOperation && apiKeyRecord.scope === 'read-only') {
    return {
      isValid: false,
      userEmail: apiKeyRecord.userEmail,
      scope: apiKeyRecord.scope,
      error: 'Forbidden: API key has read-only access scope',
      statusCode: 403
    };
  }

  return {
    isValid: true,
    userEmail: apiKeyRecord.userEmail,
    scope: apiKeyRecord.scope,
    apiKeyId: apiKeyRecord.id
  };
}
