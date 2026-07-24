import { getRedisClient } from './redis-cache'

interface RateLimitEntry {
  count: number
  resetAt: number
}

const store = new Map<string, RateLimitEntry>()

let intervalHandle: ReturnType<typeof setInterval> | null = null

function startCleanup() {
  if (intervalHandle) return
  intervalHandle = setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of store.entries()) {
      if (entry.resetAt <= now) {
        store.delete(key)
      }
    }
  }, 60_000)
}

export function stopCleanup() {
  if (intervalHandle) {
    clearInterval(intervalHandle)
    intervalHandle = null
  }
}

startCleanup()

export interface RateLimitConfig {
  windowMs: number
  maxAttempts: number
}

export const LIMITS = {
  LOGIN: { windowMs: 15 * 60 * 1000, maxAttempts: 5 },
  REGISTER: { windowMs: 60 * 60 * 1000, maxAttempts: 3 },
  // Per-source ceiling. Higher than the per-account limit so that shared
  // egress IPs (offices, mobile carriers, CGNAT) are not locked out by a few
  // users mistyping passwords, while still capping credential stuffing.
  LOGIN_PER_IP: { windowMs: 15 * 60 * 1000, maxAttempts: 30 },
  REGISTER_PER_IP: { windowMs: 60 * 60 * 1000, maxAttempts: 10 },
}

/**
 * Resolves the client IP from proxy headers. Railway terminates TLS upstream,
 * so the socket address is always the proxy; x-forwarded-for is the only
 * signal available. It is client-spoofable, which is why it is used as a
 * coarse ceiling rather than the sole control.
 */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  return request.headers.get('x-real-ip')?.trim() || 'unknown'
}

/**
 * In-process fallback, correct at exactly one replica. Used whenever Redis is
 * unset or unreachable so a single-instance deployment (or local dev) keeps
 * working exactly as before Redis-backing was added.
 */
function checkRateLimitInMemory(
  key: string,
  config: RateLimitConfig,
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now()
  const entry = store.get(key)

  if (!entry || entry.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + config.windowMs })
    return { allowed: true, remaining: config.maxAttempts - 1, resetAt: now + config.windowMs }
  }

  if (entry.count >= config.maxAttempts) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt }
  }

  entry.count++
  return { allowed: true, remaining: config.maxAttempts - entry.count, resetAt: entry.resetAt }
}

/**
 * Redis-backed counter shared by every replica. Mirrors the fallback pattern
 * used by `ResilientQueue` in `lib/queue.ts`: try Redis first, and let the
 * caller (`checkRateLimit`) fall back to the in-memory store on any error so
 * a Redis outage degrades to per-replica limiting instead of failing closed
 * or open.
 */
async function checkRateLimitRedis(
  client: NonNullable<ReturnType<typeof getRedisClient>>,
  key: string,
  config: RateLimitConfig,
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const redisKey = `ratelimit:${key}`
  const count = await client.incr(redisKey)

  if (count === 1) {
    // Only the request that created the counter sets its expiry, so later
    // requests in the same window don't keep pushing the reset time out.
    await client.expire(redisKey, Math.ceil(config.windowMs / 1000))
  }

  const ttlMs = await client.pttl(redisKey)
  const resetAt = Date.now() + (ttlMs && ttlMs > 0 ? ttlMs : config.windowMs)

  return {
    allowed: count <= config.maxAttempts,
    remaining: Math.max(0, config.maxAttempts - count),
    resetAt,
  }
}

export async function checkRateLimit(
  key: string,
  config: RateLimitConfig,
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const client = getRedisClient()

  if (client) {
    try {
      return await checkRateLimitRedis(client, key, config)
    } catch (err: any) {
      console.warn(`⚠️ Redis rate limit check failed for ${key}, falling back to in-memory: `, err.message)
    }
  }

  return checkRateLimitInMemory(key, config)
}
