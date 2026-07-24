import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mock fns so they can be referenced both inside vi.mock('ioredis', ...) and in test bodies.
const { mockIncr, mockExpire, mockPttl } = vi.hoisted(() => ({
  mockIncr: vi.fn(),
  mockExpire: vi.fn(),
  mockPttl: vi.fn(),
}));

vi.mock('ioredis', () => {
  const MockRedis = vi.fn().mockImplementation(function () {
    return {
      incr: mockIncr,
      expire: mockExpire,
      pttl: mockPttl,
      on: vi.fn(),
    };
  });
  return {
    default: MockRedis,
    Redis: MockRedis,
  };
});

import { checkRateLimit, type RateLimitConfig } from '@/lib/rate-limiter';

describe('Redis-Backed Rate Limiter (Issue 197)', () => {
  const config: RateLimitConfig = { windowMs: 60_000, maxAttempts: 3 };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Redis available: shared counter across "processes"', () => {
    it('increments a Redis counter (not just local memory) on every check, so two concurrent replicas sharing the same Redis instance see a shared count', async () => {
      // Simulate a Redis INCR counter server-side, independent of any
      // per-process in-memory state. If the implementation were still using
      // the local Map as source of truth when Redis is available, this
      // mock counter would never be consulted and the test would fail to
      // observe the expected sequence.
      let redisCounter = 0;
      mockIncr.mockImplementation(async () => {
        redisCounter += 1;
        return redisCounter;
      });
      mockExpire.mockResolvedValue(1);
      mockPttl.mockResolvedValue(60_000);

      const key = `shared-key-${Date.now()}`;

      // "Process A" call
      const r1 = await checkRateLimit(key, config);
      // "Process B" call using the same key/Redis - must see the count Process A left behind
      const r2 = await checkRateLimit(key, config);
      const r3 = await checkRateLimit(key, config);
      // 4th call exceeds maxAttempts (3)
      const r4 = await checkRateLimit(key, config);

      expect(mockIncr).toHaveBeenCalledTimes(4);
      expect(r1.allowed).toBe(true);
      expect(r2.allowed).toBe(true);
      expect(r3.allowed).toBe(true);
      expect(r4.allowed).toBe(false);
    });

    it('sets an expiry on the Redis key only on the first increment for a window', async () => {
      let redisCounter = 0;
      mockIncr.mockImplementation(async () => {
        redisCounter += 1;
        return redisCounter;
      });
      mockExpire.mockResolvedValue(1);
      mockPttl.mockResolvedValue(60_000);

      const key = `expiry-key-${Date.now()}`;
      await checkRateLimit(key, config);
      await checkRateLimit(key, config);

      expect(mockExpire).toHaveBeenCalledTimes(1);
    });
  });

  describe('Redis unavailable: falls back to existing in-memory behavior', () => {
    it('falls back to allow/deny using in-memory tracking when Redis throws', async () => {
      mockIncr.mockRejectedValue(new Error('ECONNREFUSED: Redis unreachable'));

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

    it('does not throw to the caller when Redis is unavailable', async () => {
      mockIncr.mockRejectedValue(new Error('Connection refused'));
      const key = `no-throw-key-${Date.now()}`;
      await expect(checkRateLimit(key, config)).resolves.toHaveProperty('allowed');
    });
  });
});
