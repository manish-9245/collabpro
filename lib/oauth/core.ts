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

export const CONSENT_TOKEN_TTL_MS = 10 * 60 * 1000;

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is required');
  return secret;
}

function consentMac(fields: ConsentFields, issuedAt: number): string {
  const payload = JSON.stringify([
    'consent-v2', issuedAt, fields.userEmail, fields.clientId, fields.redirectUri, fields.codeChallenge, fields.state, fields.scope,
  ]);
  return createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
}

/**
 * Stateless CSRF token for the consent form: `<issuedAt>.<HMAC>` over every
 * field the POST acts on, keyed by the server secret, bound to the signed-in
 * user and valid for 10 minutes. A cross-site POST cannot compute it, a token
 * minted for one request cannot authorize a different client/redirect/scope,
 * and a leaked token goes stale.
 */
export function consentToken(fields: ConsentFields, now: number = Date.now()): string {
  return `${now}.${consentMac(fields, now)}`;
}

export function verifyConsentToken(token: string, fields: ConsentFields, now: number = Date.now()): boolean {
  const dot = token.indexOf('.');
  if (dot < 1) return false;
  const issuedAt = Number(token.slice(0, dot));
  if (!Number.isSafeInteger(issuedAt) || issuedAt > now + 60_000 || now - issuedAt > CONSENT_TOKEN_TTL_MS) return false;
  const expected = Buffer.from(consentMac(fields, issuedAt));
  const actual = Buffer.from(token.slice(dot + 1));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export const MCP_RESOURCE_PATH = '/api/mcp';

export interface BaseUrlInfo {
  url: string;
  /** True when pinned by APP_URL/OAUTH_ISSUER (trusted); false when derived from request headers. */
  pinned: boolean;
}

/**
 * Public origin used in metadata documents. APP_URL/OAUTH_ISSUER pins it. When
 * derived from X-Forwarded-* headers it is attacker-influenceable, so callers
 * must not let a shared cache store anything built from it (see metadataHeaders).
 */
export function baseUrlFrom(host: string | null, proto: string | null, fallbackUrl: string): BaseUrlInfo {
  const configured = process.env.APP_URL || process.env.OAUTH_ISSUER;
  if (configured) return { url: configured.replace(/\/$/, ''), pinned: true };
  const u = new URL(fallbackUrl);
  const h = host || u.host;
  const p = proto?.split(',')[0].trim() || u.protocol.replace(':', '');
  // Reject anything that is not a plain host[:port] over http(s).
  if (!/^[a-z0-9.\-:[\]]+$/i.test(h) || !/^https?$/.test(p)) return { url: u.origin, pinned: false };
  return { url: `${p}://${h}`, pinned: false };
}

export function getBaseUrlInfo(request: Request): BaseUrlInfo {
  const h = request.headers;
  return baseUrlFrom(h.get('x-forwarded-host'), h.get('x-forwarded-proto'), request.url);
}

export function getBaseUrl(request: Request): string {
  return getBaseUrlInfo(request).url;
}

/** Discovery documents are cacheable only when the origin they contain is pinned (no cache poisoning via forged Host). */
export function metadataHeaders(info: BaseUrlInfo): Record<string, string> {
  return {
    'Cache-Control': info.pinned ? 'public, max-age=300' : 'no-store',
    'Access-Control-Allow-Origin': '*',
    'X-Content-Type-Options': 'nosniff',
  };
}

/** RFC 8707: a `resource` parameter, when sent, must name this MCP server (trailing slash tolerated). */
export function resourceMatches(resource: string | null | undefined, baseUrl: string): boolean {
  if (!resource) return true;
  return resource.replace(/\/$/, '') === `${baseUrl}${MCP_RESOURCE_PATH}`;
}

export function isLoopbackRedirect(uri: string): boolean {
  try {
    const u = new URL(uri);
    return u.protocol === 'http:' && isLoopbackHost(u.hostname);
  } catch {
    return false;
  }
}

/** Client names are shown on the consent page: strip control/bidi characters and cap the length. */
export function sanitizeClientName(raw: unknown): string {
  const cleaned = String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .trim()
    .slice(0, 60);
  return cleaned || 'MCP client';
}

/** Parameter caps for /oauth/authorize - generous for real clients, small enough to refuse abuse. */
export const MAX_PARAM = { clientId: 100, redirectUri: 512, state: 512, scope: 200, resource: 512 } as const;

/** Append a query param set to a (validated) redirect URI. */
export function buildRedirect(redirectUri: string, params: Record<string, string | undefined>): string {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v);
  return u.toString();
}
