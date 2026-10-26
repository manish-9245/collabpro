import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Pure helpers for CollabPro's OAuth 2.1 authorization server (the sign-in
 * flow Claude connectors use against /api/mcp). No I/O here so the security
 * rules - redirect matching, PKCE, scope parsing, consent CSRF - are unit
 * testable on their own. Persistence lives in lib/oauth/store.ts.
 */

export const ACCESS_TOKEN_PREFIX = 'collabpro_oat_';
export const REFRESH_TOKEN_PREFIX = 'collabpro_ort_';
export const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000; // 1h
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30d
export const AUTH_CODE_TTL_MS = 60 * 1000; // 60s

export const SCOPE_READ = 'mcp:read';
export const SCOPE_WRITE = 'mcp:write';
export const SUPPORTED_SCOPES = [SCOPE_READ, SCOPE_WRITE, 'offline_access'] as const;

/** Hosted Claude surfaces (claude.ai, Desktop, mobile, Cowork) share this callback. */
export const CLAUDE_CALLBACK = 'https://claude.ai/api/mcp/auth_callback';

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function randomToken(prefix: string): string {
  return `${prefix}${randomBytes(32).toString('base64url')}`;
}

export function randomId(): string {
  return randomBytes(16).toString('hex');
}

/** RFC 7636 S256: BASE64URL(SHA256(verifier)) must equal the stored challenge. */
export function verifyPkceS256(verifier: string, challenge: string): boolean {
  // RFC 7636 section 4.1: verifier is 43-128 chars of [A-Za-z0-9-._~]
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  const computed = createHash('sha256').update(verifier).digest('base64url');
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function isValidCodeChallenge(challenge: string): boolean {
  // base64url of a 32-byte SHA-256 digest is exactly 43 chars
  return /^[A-Za-z0-9\-_]{43}$/.test(challenge);
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

/**
 * Registration-time check. Only the Claude hosted callback and RFC 8252
 * loopback redirects (Claude Code) are accepted - arbitrary https redirect
 * URIs would let any registered client receive another user's auth code.
 */
export function isAllowedRedirectUri(uri: string): boolean {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.hash) return false;
  if (u.username || u.password) return false;
  if (uri === CLAUDE_CALLBACK) return true;
  return u.protocol === 'http:' && isLoopbackHost(u.hostname) && u.search === '';
}

/**
 * Request-time check against a client's registered URIs: exact match, except
 * loopback redirects ignore the port (RFC 8252 section 7.3).
 */
export function redirectUriMatches(registered: string[], requested: string): boolean {
  if (registered.includes(requested)) return true;
  let req: URL;
  try {
    req = new URL(requested);
  } catch {
    return false;
  }
  if (req.protocol !== 'http:' || !isLoopbackHost(req.hostname)) return false;
  return registered.some((r) => {
    try {
      const reg = new URL(r);
      return reg.protocol === 'http:' && reg.hostname === req.hostname && reg.pathname === req.pathname && req.search === '';
    } catch {
      return false;
    }
  });
}

/** Keeps only scopes we support. Read is always granted; write only when asked. */
export function normalizeScope(raw: string | null | undefined): string {
  const requested = new Set((raw ?? '').split(/\s+/).filter(Boolean));
  const out: string[] = [SCOPE_READ];
  if (requested.has(SCOPE_WRITE)) out.push(SCOPE_WRITE);
  if (requested.has('offline_access')) out.push('offline_access');
  return out.join(' ');
}

/** Maps an OAuth scope string to the API-key scope vocabulary tools.ts already enforces. */
export function toApiScope(scope: string): 'read-only' | 'read-write' {
  return scope.split(' ').includes(SCOPE_WRITE) ? 'read-write' : 'read-only';
}

export interface ConsentFields {
  userEmail: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
  scope: string;
}

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is required');
  return secret;
}

/**
 * Stateless CSRF token for the consent form: an HMAC over every field the
 * POST will act on, keyed by the server secret and bound to the signed-in
 * user. A cross-site POST cannot compute it, and a token minted for one
 * request cannot be replayed to authorize a different client/redirect/scope.
 */
export function consentToken(fields: ConsentFields): string {
  const payload = JSON.stringify([
    'consent-v1', fields.userEmail, fields.clientId, fields.redirectUri, fields.codeChallenge, fields.state, fields.scope,
  ]);
  return createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
}

export function verifyConsentToken(token: string, fields: ConsentFields): boolean {
  const expected = Buffer.from(consentToken(fields));
  const actual = Buffer.from(token);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Public origin used in metadata documents. Honors an explicit env override and proxy headers (Railway). */
export function getBaseUrl(request: Request): string {
  const configured = process.env.APP_URL || process.env.OAUTH_ISSUER;
  if (configured) return configured.replace(/\/$/, '');
  const url = new URL(request.url);
  const host = request.headers.get('x-forwarded-host') || url.host;
  const proto = request.headers.get('x-forwarded-proto')?.split(',')[0].trim() || url.protocol.replace(':', '');
  return `${proto}://${host}`;
}

/** Append a query param set to a (validated) redirect URI. */
export function buildRedirect(redirectUri: string, params: Record<string, string | undefined>): string {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v);
  return u.toString();
}
