import { describe, it, expect, vi, beforeEach } from 'vitest';

const verifyOAuth = vi.hoisted(() => vi.fn());
vi.mock('@/lib/oauth/store', () => ({ verifyOAuthAccessToken: verifyOAuth }));
vi.mock('@/lib/db', () => ({ prisma: { apiKey: { findUnique: vi.fn().mockResolvedValue(null) } } }));

import { verifyApiKey } from '@/lib/api-key-middleware';

beforeEach(() => { vi.clearAllMocks(); delete process.env.OAUTH_DISABLED; });

describe('OAuth access tokens in verifyApiKey', () => {
  const header = 'Bearer collabpro_oat_abc';

  it('are rejected on endpoints that do not opt in (audience binding)', async () => {
    const res = await verifyApiKey(header);
    expect(res).toMatchObject({ isValid: false, statusCode: 401 });
    expect(verifyOAuth).not.toHaveBeenCalled();
  });

  it('are accepted on opt-in endpoints and expose the client id', async () => {
    verifyOAuth.mockResolvedValue({ id: 't1', familyId: 'fam1', userEmail: 'u@x.co', clientId: 'c1', scope: 'read-only' });
    const res = await verifyApiKey(header, undefined, { allowOAuth: true });
    // Keyed by the grant FAMILY, which survives refresh rotation, so refreshing never earns a fresh rate-limit bucket.
    expect(res).toMatchObject({ isValid: true, userEmail: 'u@x.co', scope: 'read-only', oauthClientId: 'c1', apiKeyId: 'oauth:fam1' });
  });

  it('read-only tokens are forbidden on write operations', async () => {
    verifyOAuth.mockResolvedValue({ id: 't1', userEmail: 'u@x.co', clientId: 'c1', scope: 'read-only' });
    expect(await verifyApiKey(header, true, { allowOAuth: true })).toMatchObject({ isValid: false, statusCode: 403 });
  });

  it('unknown/expired tokens are 401', async () => {
    verifyOAuth.mockResolvedValue(null);
    expect(await verifyApiKey(header, undefined, { allowOAuth: true })).toMatchObject({ isValid: false, statusCode: 401 });
  });

  it('are refused entirely when OAUTH_DISABLED', async () => {
    process.env.OAUTH_DISABLED = 'true';
    expect(await verifyApiKey(header, undefined, { allowOAuth: true })).toMatchObject({ isValid: false, statusCode: 401 });
    expect(verifyOAuth).not.toHaveBeenCalled();
  });
});
