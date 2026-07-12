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
 * Cache-Aside strategy: retrieves file from Redis cache, falls back to Postgres on miss,
 * and populates cache with a 10-minute TTL.
 */
export async function getCachedFile(fileId: string): Promise<any> {
  const cacheKey = `collabpro:file:${fileId}`;
  const client = getRedisClient();

  if (client) {
    try {
      const cachedData = await client.get(cacheKey);
      if (cachedData) {
        console.log(`🚀 [Redis Hit] Served file ${fileId} in < 5ms`);
        return JSON.parse(cachedData);
      }
    } catch (redisError: any) {
      console.warn(`⚠️ Redis read failed for file ${fileId}, falling back to DB: `, redisError.message);
    }
  }

  // Cache Miss or Redis offline -> Read from database
  const dbFile = await prisma.file.findUnique({
    where: { id: fileId },
  });

  if (dbFile && client) {
    try {
      // Populate cache with a 10-minute (600s) TTL
      await client.set(cacheKey, JSON.stringify(dbFile), 'EX', 600);
      console.log(`📥 [Redis Populate] Cached file ${fileId} with 600s TTL`);
    } catch (setCacheError: any) {
      console.warn(`⚠️ Failed to populate Redis cache for file ${fileId}: `, setCacheError.message);
    }
  }

  return dbFile;
}

/**
 * Transactional cache invalidation: deletes the cached file entry in Redis.
 */
export async function invalidateCachedFile(fileId: string): Promise<void> {
  const cacheKey = `collabpro:file:${fileId}`;
  const client = getRedisClient();

  if (client) {
    try {
      await client.del(cacheKey);
      console.log(`🗑️ [Redis Invalidate] Purged key ${cacheKey}`);
    } catch (invalidationError: any) {
      console.warn(`⚠️ Failed to invalidate Redis cache for file ${fileId}: `, invalidationError.message);
    }
  }
}
