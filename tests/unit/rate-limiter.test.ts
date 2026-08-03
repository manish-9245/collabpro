import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoisted mock fns so they can be referenced both inside vi.mock('ioredis', ...) and in test bodies.
const { mockEval } = vi.hoisted(() => ({
  mockEval: vi.fn(),
}));

vi.mock('ioredis', () => {
  const MockRedis = vi.fn().mockImplementation(function () {
    return {
      eval: mockEval,
      on: vi.fn(),
    };
  });
  return {
    default: MockRedis,
    Redis: MockRedis,
  };
});

import { checkRateLimit, getClientIp, type RateLimitConfig } from '@/lib/rate-limiter';

describe('getClientIp (issue #235 — spoofable leftmost X-Forwarded-For hop)', () => {
  it('prefers x-real-ip over x-forwarded-for — Railway sets it itself and a client cannot forge it', () => {
    const request = new Request('http://localhost', {
      headers: {
        'x-real-ip': '203.0.113.5',
        'x-forwarded-for': 'attacker-controlled-anything',
      },
    });
    expect(getClientIp(request)).toBe('203.0.113.5');
  });

  it('falls back to the rightmost X-Forwarded-For hop when x-real-ip is absent', () => {
    const request = new Request('http://localhost', {
      headers: { 'x-forwarded-for': '9.9.9.9, 203.0.113.5' },
    });
    // 203.0.113.5 is the trailing hop; 9.9.9.9 is whatever the client
    // claimed and must not be trusted as the sole signal.
    expect(getClientIp(request)).toBe('203.0.113.5');
  });

  it('is not defeated by a client sending an arbitrary spoofed leftmost value, in the x-forwarded-for fallback path', () => {
    const legit = new Request('http://localhost', {
      headers: { 'x-forwarded-for': '203.0.113.5' },
    });
    const spoofed = new Request('http://localhost', {
      headers: { 'x-forwarded-for': 'attacker-controlled-anything, 203.0.113.5' },
    });
    expect(getClientIp(spoofed)).toBe(getClientIp(legit));
  });

  it('ignores blank X-Forwarded-For hops', () => {
    const request = new Request('http://localhost', {
      headers: { 'x-forwarded-for': ' 9.9.9.9, , 203.0.113.5, ' },
    });
    expect(getClientIp(request)).toBe('203.0.113.5');
  });

  it('falls back to "unknown" when x-forwarded-for has no non-empty hop and x-real-ip is absent', () => {
    const request = new Request('http://localhost', {
      headers: { 'x-forwarded-for': ' , ' },
    });
    expect(getClientIp(request)).toBe('unknown');
  });

  it('falls back to "unknown" when no IP header is present', () => {
    const request = new Request('http://localhost');
    expect(getClientIp(request)).toBe('unknown');
  });
});

describe('Redis-Backed Rate Limiter (Issue 197)', () => {
  const config: RateLimitConfig = { windowMs: 60_000, maxAttempts: 3 };
  const originalRedisUrl = process.env.REDIS_URL;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalRedisUrl === undefined) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = originalRedisUrl;
    }
  });

  /**
   * A tiny in-memory stand-in for what the real atomic Lua script does, used
   * to drive the mocked `eval` calls: INCR the counter, PEXPIRE only on the
   * first hit (or if the TTL was somehow missing/negative - the self-heal
   * path), and return [count, ttlMs]. This lets tests assert on the
   * *behavior* `checkRateLimit` produces from a single atomic call, without
   * needing a real Redis.
   */
  function makeFakeRedisScriptStore() {
    const store = new Map<string, { count: number; ttlMs: number }>();
    mockEval.mockImplementation(async (_script: string, _numKeys: number, key: string, windowMsArg: string) => {
      const windowMs = Number(windowMsArg);
      const entry = store.get(key) ?? { count: 0, ttlMs: -1 };
      entry.count += 1;
      if (entry.count === 1 || entry.ttlMs < 0) {
        entry.ttlMs = windowMs;
      }
      store.set(key, entry);
      return [entry.count, entry.ttlMs];
    });
    return store;
  }

  describe('Redis available (REDIS_URL set): shared counter across "processes"', () => {
    beforeEach(() => {
      process.env.REDIS_URL = 'redis://localhost:6379';
    });

    it('increments via a single atomic call (not separate incr/expire round trips) so two concurrent replicas sharing the same Redis instance see a shared count', async () => {
      makeFakeRedisScriptStore();

      const key = `shared-key-${Date.now()}`;

      // "Process A" call
      const r1 = await checkRateLimit(key, config);
      // "Process B" call using the same key/Redis - must see the count Process A left behind
      const r2 = await checkRateLimit(key, config);
      const r3 = await checkRateLimit(key, config);
      // 4th call exceeds maxAttempts (3)
      const r4 = await checkRateLimit(key, config);

      // One call site, one round trip per check - proves the increment and
      // its expiry are one atomic operation, not two separate commands a
      // crash could split.
      expect(mockEval).toHaveBeenCalledTimes(4);
      expect(r1.allowed).toBe(true);
      expect(r2.allowed).toBe(true);
      expect(r3.allowed).toBe(true);
      expect(r4.allowed).toBe(false);
    });

    it('does not push the reset time forward on every subsequent call within the same window', async () => {
      makeFakeRedisScriptStore();

      const key = `expiry-key-${Date.now()}`;
      const r1 = await checkRateLimit(key, config);
      const r2 = await checkRateLimit(key, config);

      // Both calls happen within the same window; resetAt should reflect
      // the same underlying TTL, not be pushed out by the second call.
      expect(Math.abs(r2.resetAt - r1.resetAt)).toBeLessThan(1000);
    });

    it('self-heals and continues counting instead of permanently locking a bucket whose TTL was lost between INCR and EXPIRE', async () => {
      const store = makeFakeRedisScriptStore();
      const key = `orphaned-ttl-key-${Date.now()}`;

      // Simulate the exact failure this fix targets: a counter that exists
      // (e.g. from a crash between INCR and EXPIRE under the old two-step
      // implementation) but carries no TTL. Pre-seed under the same
      // `ratelimit:` prefix checkRateLimitRedis uses, or the lookup below
      // never observes this entry and the self-heal path goes untested.
      store.set(`ratelimit:${key}`, { count: 5000, ttlMs: -1 });

      const result = await checkRateLimit(key, config);

      // The bucket must not be permanently denied just because it has a
      // huge stale count with no expiry - the atomic script's self-heal
      // path resets the TTL on read so the bucket recovers on schedule
      // instead of never expiring.
      expect(result.resetAt).toBeGreaterThan(Date.now());
      expect(result.resetAt).toBeLessThanOrEqual(Date.now() + config.windowMs + 1000);
    });
  });

  describe('REDIS_URL not configured: skips Redis entirely, uses in-memory tracking', () => {
    beforeEach(() => {
      delete process.env.REDIS_URL;
    });

    it('never calls Redis when REDIS_URL is unset, going straight to the in-memory fallback', async () => {
      const key = `no-redis-url-key-${Date.now()}`;
      const r1 = await checkRateLimit(key, config);

      // getRedisClient() defaults to localhost:6379 when REDIS_URL is unset;
      // without the explicit env-var guard this would still attempt (and
      // then fail/timeout) a real connection on every call in an
      // environment like production collabpro where REDIS_URL isn't set.
      expect(mockEval).not.toHaveBeenCalled();
      expect(r1.allowed).toBe(true);
    });

    it('still enforces the limit via in-memory tracking with no Redis configured', async () => {
      const key = `no-redis-url-limit-key-${Date.now()}`;
      const r1 = await checkRateLimit(key, config);
      const r2 = await checkRateLimit(key, config);
      const r3 = await checkRateLimit(key, config);
      const r4 = await checkRateLimit(key, config);

      expect(r1.allowed).toBe(true);
      expect(r2.allowed).toBe(true);
      expect(r3.allowed).toBe(true);
      expect(r4.allowed).toBe(false);
      expect(mockEval).not.toHaveBeenCalled();
    });
  });

  describe('Redis configured but unreachable: falls back to existing in-memory behavior', () => {
    beforeEach(() => {
      process.env.REDIS_URL = 'redis://localhost:6379';
    });

    it('falls back to allow/deny using in-memory tracking when the Redis call throws', async () => {
      mockEval.mockRejectedValue(new Error('ECONNREFUSED: Redis unreachable'));

      const key = `fallback-key-${Date.now()}`;
      const r1 = await checkRateLimit(key, config);
      const r2 = await checkRateLimit(key, config);
      const r3 = await checkRateLimit(key, config);
      const r4 = await checkRateLimit(key, config);

      expect(r1.allowed).toBe(true);
      expect(r2.allowed).toBe(true);
      expect(r3.allowed).toBe(true);
      // 4th attempt exceeds maxAttempts (3) via in-memory fallback tracking
      expect(r4.allowed).toBe(false);
    });

    it('does not throw to the caller when Redis is unreachable', async () => {
      mockEval.mockRejectedValue(new Error('Connection refused'));
      const key = `no-throw-key-${Date.now()}`;
      await expect(checkRateLimit(key, config)).resolves.toHaveProperty('allowed');
    });

    it('does not log the raw rate-limit key (it embeds email/IP) on a Redis failure', async () => {
      mockEval.mockRejectedValue(new Error('Connection refused'));
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const sensitiveKey = `login:ip-account:203.0.113.5:victim@example.com`;
      await checkRateLimit(sensitiveKey, config);

      const loggedText = warnSpy.mock.calls.map(call => call.join(' ')).join('\n');
      expect(loggedText).not.toContain(sensitiveKey);
      expect(loggedText).not.toContain('victim@example.com');
      warnSpy.mockRestore();
    });
  });
});
