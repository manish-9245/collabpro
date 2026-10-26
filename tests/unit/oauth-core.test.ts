import { describe, it, expect, beforeAll } from 'vitest';
import { createHash } from 'crypto';
import {
  CLAUDE_CALLBACK, consentToken, isAllowedRedirectUri, isValidCodeChallenge, normalizeScope,
  redirectUriMatches, toApiScope, verifyConsentToken, verifyPkceS256, getBaseUrl, baseUrlFrom, resourceMatches,
  sanitizeClientName, isLoopbackRedirect, CONSENT_TOKEN_TTL_MS,
} from '@/lib/oauth/core';

beforeAll(() => {
  process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret-1234';
});

const verifier = 'a'.repeat(43);
const challenge = createHash('sha256').update(verifier).digest('base64url');

describe('PKCE', () => {
  it('accepts a matching S256 verifier', () => {
    expect(verifyPkceS256(verifier, challenge)).toBe(true);
    expect(isValidCodeChallenge(challenge)).toBe(true);
  });
  it('rejects wrong, short, or malformed verifiers', () => {
    expect(verifyPkceS256('b'.repeat(43), challenge)).toBe(false);
    expect(verifyPkceS256('short', challenge)).toBe(false);
    expect(verifyPkceS256(`${'a'.repeat(42)}!`, challenge)).toBe(false);
  });
  it('rejects a plain (non-S256-shaped) challenge', () => {
    expect(isValidCodeChallenge('a'.repeat(44))).toBe(false);
    expect(isValidCodeChallenge('x')).toBe(false);
  });
});

describe('redirect URIs', () => {
  it('allows the Claude callback and loopback only at registration', () => {
    expect(isAllowedRedirectUri(CLAUDE_CALLBACK)).toBe(true);
    expect(isAllowedRedirectUri('http://localhost:3118/callback')).toBe(true);
    expect(isAllowedRedirectUri('http://127.0.0.1/callback')).toBe(true);
    expect(isAllowedRedirectUri('https://evil.example.com/cb')).toBe(false);
    expect(isAllowedRedirectUri('http://evil.example.com/cb')).toBe(false);
    expect(isAllowedRedirectUri('https://claude.ai/api/mcp/auth_callback#x')).toBe(false);
    expect(isAllowedRedirectUri('https://claude.ai.evil.com/api/mcp/auth_callback')).toBe(false);
    expect(isAllowedRedirectUri('javascript:alert(1)')).toBe(false);
    expect(isAllowedRedirectUri('not a url')).toBe(false);
  });
  it('matches exactly, except loopback ignores the port', () => {
    expect(redirectUriMatches([CLAUDE_CALLBACK], CLAUDE_CALLBACK)).toBe(true);
    expect(redirectUriMatches([CLAUDE_CALLBACK], `${CLAUDE_CALLBACK}?x=1`)).toBe(false);
    expect(redirectUriMatches(['http://localhost/callback'], 'http://localhost:51234/callback')).toBe(true);
    expect(redirectUriMatches(['http://localhost/callback'], 'http://127.0.0.1:51234/callback')).toBe(false);
    expect(redirectUriMatches(['http://localhost/callback'], 'http://localhost:51234/other')).toBe(false);
    expect(redirectUriMatches(['http://localhost/callback'], 'https://localhost:1/callback')).toBe(false);
  });
});

describe('scopes', () => {
  it('always grants read, only adds write when requested, drops unknowns', () => {
    expect(normalizeScope(undefined)).toBe('mcp:read');
    expect(normalizeScope('mcp:write admin')).toBe('mcp:read mcp:write');
    expect(normalizeScope('offline_access')).toBe('mcp:read offline_access');
  });
  it('maps to the API-key scope vocabulary', () => {
    expect(toApiScope('mcp:read')).toBe('read-only');
    expect(toApiScope('mcp:read mcp:write')).toBe('read-write');
  });
});

describe('consent CSRF token', () => {
  const fields = { userEmail: 'a@b.co', clientId: 'c1', redirectUri: CLAUDE_CALLBACK, codeChallenge: challenge, state: 's', scope: 'mcp:read' };
  it('verifies for identical fields and fails if any field changes', () => {
    const token = consentToken(fields);
    expect(verifyConsentToken(token, fields)).toBe(true);
    for (const k of Object.keys(fields) as (keyof typeof fields)[]) {
      expect(verifyConsentToken(token, { ...fields, [k]: `${fields[k]}x` })).toBe(false);
    }
    expect(verifyConsentToken('garbage', fields)).toBe(false);
  });
});

describe('getBaseUrl', () => {
  it('prefers APP_URL, then forwarded headers', () => {
    delete process.env.APP_URL;
    delete process.env.OAUTH_ISSUER;
    const req = new Request('http://internal:3000/x', { headers: { 'x-forwarded-host': 'app.example.com', 'x-forwarded-proto': 'https' } });
    expect(getBaseUrl(req)).toBe('https://app.example.com');
    process.env.APP_URL = 'https://override.example.com/';
    expect(getBaseUrl(req)).toBe('https://override.example.com');
    delete process.env.APP_URL;
  });
});


describe('consent token lifetime', () => {
  const f = { userEmail: 'a@b.co', clientId: 'c1', redirectUri: CLAUDE_CALLBACK, codeChallenge: challenge, state: 's', scope: 'mcp:read' };
  it('expires after 10 minutes and rejects tokens from the future', () => {
    const now = 1_700_000_000_000;
    const t = consentToken(f, now);
    expect(verifyConsentToken(t, f, now + CONSENT_TOKEN_TTL_MS - 1)).toBe(true);
    expect(verifyConsentToken(t, f, now + CONSENT_TOKEN_TTL_MS + 1)).toBe(false);
    expect(verifyConsentToken(consentToken(f, now + 3_600_000), f, now)).toBe(false);
  });
  it('rejects a token whose timestamp was tampered with', () => {
    const now = Date.now();
    const [, mac] = consentToken(f, now).split('.');
    expect(verifyConsentToken(`${now + 1}.${mac}`, f, now + 2)).toBe(false);
    expect(verifyConsentToken('nodot', f)).toBe(false);
    expect(verifyConsentToken('abc.def', f)).toBe(false);
  });
});

describe('base URL trust', () => {
  beforeAll(() => { delete process.env.APP_URL; delete process.env.OAUTH_ISSUER; });
  it('flags header-derived origins as unpinned and APP_URL as pinned', () => {
    expect(baseUrlFrom('app.example.com', 'https', 'http://internal/x')).toEqual({ url: 'https://app.example.com', pinned: false });
    process.env.APP_URL = 'https://pinned.example.com';
    expect(baseUrlFrom('evil.com', 'https', 'http://internal/x')).toEqual({ url: 'https://pinned.example.com', pinned: true });
    delete process.env.APP_URL;
  });
  it('ignores malformed forwarded hosts/protos instead of reflecting them', () => {
    expect(baseUrlFrom('evil.com/path?x=<script>', 'https', 'http://internal:3000/x').url).toBe('http://internal:3000');
    expect(baseUrlFrom('ok.example.com', 'javascript', 'http://internal:3000/x').url).toBe('http://internal:3000');
  });
});

describe('RFC 8707 resource', () => {
  it('accepts absent or exact (with optional trailing slash), rejects others', () => {
    expect(resourceMatches(undefined, 'https://a.co')).toBe(true);
    expect(resourceMatches('https://a.co/api/mcp', 'https://a.co')).toBe(true);
    expect(resourceMatches('https://a.co/api/mcp/', 'https://a.co')).toBe(true);
    expect(resourceMatches('https://b.co/api/mcp', 'https://a.co')).toBe(false);
    expect(resourceMatches('https://a.co/other', 'https://a.co')).toBe(false);
  });
});

describe('client-supplied display data', () => {
  it('sanitizes control and bidi characters and caps length', () => {
    expect(sanitizeClientName('Cla\u202Eude\u0000')).toBe('Claude');
    expect(sanitizeClientName('x'.repeat(200))).toHaveLength(60);
    expect(sanitizeClientName('   ')).toBe('MCP client');
    expect(sanitizeClientName(undefined)).toBe('MCP client');
  });
  it('detects loopback redirects (shown with a warning on the consent page)', () => {
    expect(isLoopbackRedirect('http://localhost:3118/callback')).toBe(true);
    expect(isLoopbackRedirect(CLAUDE_CALLBACK)).toBe(false);
  });
});
