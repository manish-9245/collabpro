import { describe, it, expect } from 'vitest';
import { safeRedirectPath } from '@/lib/safe-redirect';

const origin = 'https://app.example.com';

describe('safeRedirectPath (post-login open-redirect defense)', () => {
  it('keeps same-site paths with query and hash', () => {
    expect(safeRedirectPath('/oauth/authorize?client_id=c1&state=x', origin)).toBe('/oauth/authorize?client_id=c1&state=x');
    expect(safeRedirectPath('/workspace/abc#top', origin)).toBe('/workspace/abc#top');
  });
  it('never returns a protocol-relative result for any input', () => {
    for (const bad of ['/.//x.co', '/..//x.co', '/a/..//x.co', '/././/x.co']) {
      const out = safeRedirectPath(bad, origin);
      expect(out.startsWith('//')).toBe(false);
    }
  });
  it('falls back for absent values', () => {
    expect(safeRedirectPath(null, origin)).toBe('/dashboard');
    expect(safeRedirectPath('', origin)).toBe('/dashboard');
  });
  it.each([
    'https://evil.example.com/x',
    '//evil.example.com',
    '/\\evil.example.com',
    '/\n/evil.example.com',      // browsers strip the newline -> //evil.example.com
    '/\t/evil.example.com',
    '/\r/evil.example.com',
    'javascript:alert(1)',
    'http://app.example.com.evil.com/',
    'https://app.example.com@evil.com/',
    '/.//evil.example.com',      // dot-segment collapse -> pathname //evil.example.com
    '/..//evil.example.com',
    '/./\\evil.example.com',
    '/a/..//evil.example.com',
  ])('rejects %j', (bad) => {
    expect(safeRedirectPath(bad, origin)).toBe('/dashboard');
  });
});
