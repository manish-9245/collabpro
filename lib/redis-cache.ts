import Redis from 'ioredis';
import { prisma } from './db';

let globalRedis: Redis | null = null;

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

/**
 * Generic Cache-Aside strategy: retrieves data from Redis cache, falls back to database on miss,
 * and populates the cache with the specified TTL.
 */
export async function cacheAside<T>(
  cacheKey: string,
  ttlSeconds: number,
  fallback: () => Promise<T | null>
): Promise<T | null> {
  const client = getRedisClient();

  if (client) {
    try {
      const cachedData = await client.get(cacheKey);
      if (cachedData) {
        console.log(`🚀 [Redis Hit] Served key ${cacheKey} in < 5ms`);
        return JSON.parse(cachedData);
      }
    } catch (redisError: any) {
      console.warn(`⚠️ Redis read failed for key ${cacheKey}, falling back to source: `, redisError.message);
    }
  }

  // Cache Miss or Redis offline -> Invoke source fallback query
  const data = await fallback();

  if (data && client) {
    try {
      await client.set(cacheKey, JSON.stringify(data), 'EX', ttlSeconds);
      console.log(`📥 [Redis Populate] Cached key ${cacheKey} with ${ttlSeconds}s TTL`);
    } catch (setCacheError: any) {
      console.warn(`⚠️ Failed to populate Redis cache for key ${cacheKey}: `, setCacheError.message);
    }
  }

  return data;
}

/**
 * Generic Cache Invalidation strategy: purges the cache key from Redis.
 */
export async function invalidateCacheKey(cacheKey: string): Promise<void> {
  const client = getRedisClient();

  if (client) {
    try {
      await client.del(cacheKey);
      console.log(`🗑️ [Redis Invalidate] Purged key ${cacheKey}`);
    } catch (invalidationError: any) {
      console.warn(`⚠️ Failed to invalidate Redis cache for key ${cacheKey}: `, invalidationError.message);
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
