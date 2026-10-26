import { describe, it, expect } from 'vitest';
import { isSameOrigin } from '@/lib/oauth/http';

const BASE = 'https://app.example.com';
const req = (h: Record<string, string>) => new Request(`${BASE}/api/oauth/authorize`, { method: 'POST', headers: h });

describe('isSameOrigin', () => {
  it('accepts our own Origin', () => expect(isSameOrigin(req({ origin: BASE }))).toBe(true));
  it('rejects a foreign Origin even if Sec-Fetch-Site claims same-origin', () => {
    expect(isSameOrigin(req({ origin: 'https://evil.test', 'sec-fetch-site': 'same-origin' }))).toBe(false);
  });
  it('accepts Origin: null when Sec-Fetch-Site is same-origin', () => {
    expect(isSameOrigin(req({ origin: 'null', 'sec-fetch-site': 'same-origin' }))).toBe(true);
  });
  it('rejects Origin: null with cross-site signals or none', () => {
    expect(isSameOrigin(req({ origin: 'null', 'sec-fetch-site': 'cross-site' }))).toBe(false);
    expect(isSameOrigin(req({ origin: 'null', 'sec-fetch-site': 'cross-site', referer: `${BASE}/` }))).toBe(false);
    expect(isSameOrigin(req({}))).toBe(false);
  });
});
