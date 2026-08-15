import Redis from 'ioredis';
import { prisma } from './db';

let globalRedis: Redis | null = null;

// Circuit breaker: when Redis is unreachable (e.g. no Redis running in local
// dev), every cache op used to pay its own ~2s connectTimeout independently -
// cacheAside's get AND its later set each blocked on the same dead
// connection, adding ~4-6s to every single file load. Once any op fails,
// skip Redis entirely for this cooldown instead of re-discovering "it's
// down" on every call.
// ponytail: fixed cooldown, add jitter/backoff if this ever flaps in prod.
const REDIS_COOLDOWN_MS = 30_000;
let redisUnavailableUntil = 0;

/**
 * Returns the singleton Redis client instance or instantiates one from process.env.REDIS_URL
 */
export function getRedisClient(): Redis | null {
  if (globalRedis) {
    return globalRedis;
  }

  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

  try {
    globalRedis = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      lazyConnect: true, // Only connect on first command to prevent blocking startup
      retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 1000)), // stop trying to reconnect forever once it's clearly not there
    });

    globalRedis.on('error', (err) => {
      console.warn('⚠️ Redis Client Encountered Error: ', err.message);
    });

    return globalRedis;
  } catch (error) {
    console.error('❌ Failed to initialize Redis Client: ', error);
    return null;
  }
}

/** Redis client to use for this call, or null if it's known-unavailable within the cooldown window. */
function getAvailableRedisClient(): Redis | null {
  if (Date.now() < redisUnavailableUntil) return null;
  return getRedisClient();
}

function markRedisUnavailable(): void {
  redisUnavailableUntil = Date.now() + REDIS_COOLDOWN_MS;
}

/** Test-only: clears the circuit breaker's cooldown so each test starts from a clean state. */
export function resetRedisCircuitBreakerForTests(): void {
  redisUnavailableUntil = 0;
}

/**
 * Generic Cache-Aside strategy: retrieves data from Redis cache, falls back to database on miss,
 * and populates the cache with the specified TTL.
 */
export async function cacheAside<T>(
  cacheKey: string,
  ttlSeconds: number,
  fallback: () => Promise<T | null>
): Promise<T | null> {
  const client = getAvailableRedisClient();

  if (client) {
    try {
      const cachedData = await client.get(cacheKey);
      if (cachedData) {
        console.log(`🚀 [Redis Hit] Served key ${cacheKey} in < 5ms`);
        return JSON.parse(cachedData);
      }
    } catch (redisError: any) {
      console.warn(`⚠️ Redis read failed for key ${cacheKey}, falling back to source: `, redisError.message);
      markRedisUnavailable();
    }
  }

  // Cache Miss or Redis offline -> Invoke source fallback query
  const data = await fallback();

  // Re-check availability - the read above may have just tripped the
  // breaker, in which case skip the write too instead of paying its own
  // separate connection timeout.
  if (data && client && Date.now() >= redisUnavailableUntil) {
    try {
      await client.set(cacheKey, JSON.stringify(data), 'EX', ttlSeconds);
      console.log(`📥 [Redis Populate] Cached key ${cacheKey} with ${ttlSeconds}s TTL`);
    } catch (setCacheError: any) {
      console.warn(`⚠️ Failed to populate Redis cache for key ${cacheKey}: `, setCacheError.message);
      markRedisUnavailable();
    }
  }

  return data;
}

/**
 * Generic Cache Invalidation strategy: purges the cache key from Redis.
 */
export async function invalidateCacheKey(cacheKey: string): Promise<void> {
  const client = getAvailableRedisClient();

  if (client) {
    try {
      await client.del(cacheKey);
      console.log(`🗑️ [Redis Invalidate] Purged key ${cacheKey}`);
    } catch (invalidationError: any) {
      console.warn(`⚠️ Failed to invalidate Redis cache for key ${cacheKey}: `, invalidationError.message);
      markRedisUnavailable();
    }
  }
}

/**
 * Cache-Aside strategy for Files: delegates to the generic cacheAside primitive.
 */
export async function getCachedFile(fileId: string): Promise<any> {
  return cacheAside(`collabpro:file:${fileId}`, 600, () =>
    prisma.file.findUnique({
      where: { id: fileId },
    })
  );
}

/**
 * Transactional cache invalidation: delegates to the generic invalidateCacheKey primitive.
 */
export async function invalidateCachedFile(fileId: string): Promise<void> {
  return invalidateCacheKey(`collabpro:file:${fileId}`);
}
