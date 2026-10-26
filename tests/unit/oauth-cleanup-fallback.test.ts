import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = vi.hoisted(() => ({
  exchangeAuthCode: vi.fn(),
  refreshTokens: vi.fn(),
  cleanupExpired: vi.fn(),
}));
const log = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('@/lib/oauth/store', () => store);
vi.mock('@/lib/logger', () => ({ logger: log }));
vi.mock('@/lib/db', () => ({ prisma: {} }));
vi.mock('@/lib/audit', () => ({ logAuditEvent: vi.fn() }));
vi.mock('@/lib/rate-limiter', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 1, resetAt: Date.now() + 1000, firstBlock: false }),
  getClientIp: () => '203.0.113.9',
  LIMITS: { OAUTH_TOKEN: {} },
}));

const refresh = () =>
  new Request('https://x.co/api/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=refresh_token&client_id=c1&refresh_token=r',
  });

describe('token endpoint housekeeping fallback', () => {
  beforeEach(() => {
    vi.resetModules(); // fresh module state => fresh "last cleanup" timestamp
    vi.clearAllMocks();
    store.refreshTokens.mockResolvedValue({ accessToken: 'a', refreshToken: 'r2', expiresIn: 1, scope: 'mcp:read' });
  });

  it('runs at most once an hour per process, only after a successful exchange', async () => {
    store.cleanupExpired.mockResolvedValue({ codes: 0, tokens: 0, clients: 0 });
    const { POST } = await import('@/app/api/oauth/token/route');
    await POST(refresh());
    await POST(refresh());
    await POST(refresh());
    expect(store.cleanupExpired).toHaveBeenCalledTimes(1);
  });

  it('does not run on a failed exchange', async () => {
    store.refreshTokens.mockResolvedValue({ error: 'invalid_grant', description: 'bad' });
    const { POST } = await import('@/app/api/oauth/token/route');
    await POST(refresh());
    expect(store.cleanupExpired).not.toHaveBeenCalled();
  });

  it('logs a failing sweep instead of swallowing it, and never fails the token response', async () => {
    store.cleanupExpired.mockRejectedValue(new Error('db unavailable'));
    const { POST } = await import('@/app/api/oauth/token/route');
    const res = await POST(refresh());
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(log.error).toHaveBeenCalledWith('oauth_cleanup_fallback_failed', expect.objectContaining({ message: 'db unavailable' })));
  });
});
