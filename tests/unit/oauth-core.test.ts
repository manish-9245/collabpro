import { describe, it, expect, beforeAll } from 'vitest';
import { createHash } from 'crypto';
import {
  CLAUDE_CALLBACK, consentToken, isAllowedRedirectUri, isValidCodeChallenge, normalizeScope,
  redirectUriMatches, toApiScope, verifyConsentToken, verifyPkceS256, getBaseUrl,
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
