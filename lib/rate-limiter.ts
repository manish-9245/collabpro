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
  // Share-link password verification: unauthenticated by design, and unlike
  // LOGIN there is no "account" to key on — only a link (public, shared by
  // definition) and a claimed IP (spoofable). Neither alone is sufficient:
  // keying only on IP is trivially bypassed by rotating x-forwarded-for;
  // keying only on the link lets one attacker's (or one fat-fingering
  // visitor's) failed attempts lock out every *other* legitimate visitor of
  // that same link for the whole window. So two gates apply together:
  // - SHARE_VERIFY: primary, keyed on (link, ip) — bounds attempts from one
  //   apparent source against one link. Rotating IP resets only the
  //   rotating attacker's own fresh bucket; it doesn't touch other
  //   visitors' ability to verify against the same link.
  // - SHARE_VERIFY_PER_LINK: secondary, keyed on the link alone, deliberately
  //   much more generous — a backstop against a genuinely distributed
  //   brute force (many IPs against one link), set high enough that a
  //   handful of legitimate visitors occasionally mistyping never trips it.
  SHARE_VERIFY: { windowMs: 15 * 60 * 1000, maxAttempts: 10 },
  SHARE_VERIFY_PER_LINK: { windowMs: 15 * 60 * 1000, maxAttempts: 60 },
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
 * INCR + conditional PEXPIRE + PTTL as a single atomic round trip.
 *
 * A naive `INCR` then separate `EXPIRE` call is not atomic: if the process
 * crashes or the connection drops between the two, the key is left with a
 * count but no TTL, and once that bucket reaches the limit it never expires
 * — a permanent lockout with no recovery path short of manual Redis
 * intervention. Running the whole thing as one Lua script closes that
 * window (Redis executes a script's Redis calls atomically, as a single
 * command). As defense in depth, the script also self-heals: if it ever
 * finds an existing counter with no/negative TTL (e.g. a key written by an
 * older, non-atomic version of this code, or restored from a backup), it
 * repairs the TTL on read instead of leaving the bucket locked forever.
 */
const RATE_LIMIT_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if tonumber(current) == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
else
  local ttl = redis.call('PTTL', KEYS[1])
  if ttl < 0 then
    redis.call('PEXPIRE', KEYS[1], ARGV[1])
  end
end
local finalTtl = redis.call('PTTL', KEYS[1])
return {current, finalTtl}
`

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
  const [countRaw, ttlMsRaw] = await client.eval(
    RATE_LIMIT_SCRIPT,
    1,
    redisKey,
    String(config.windowMs),
  ) as [number | string, number | string]

  const count = Number(countRaw)
  const ttlMs = Number(ttlMsRaw)
  const resetAt = Date.now() + (ttlMs > 0 ? ttlMs : config.windowMs)

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
  // Only attempt Redis when it's actually configured. `getRedisClient()`
  // defaults to `redis://localhost:6379` when REDIS_URL is unset, so without
  // this guard every single call here would attempt-then-time-out a real
  // connection before falling back — REDIS_URL is currently unset on the
  // live collabpro Railway service, which would add that connect-and-fail
  // cost to every login/register request in production, not just an edge
  // case in some environments.
  if (!process.env.REDIS_URL) {
    return checkRateLimitInMemory(key, config)
  }

  const client = getRedisClient()

  if (client) {
    try {
      return await checkRateLimitRedis(client, key, config)
    } catch (err: any) {
      // Deliberately not logging `key` here — it embeds the caller's email
      // and/or IP (e.g. `login:ip-account:1.2.3.4:user@example.com`), and
      // this is a normal-operation warning path, not an audit log.
      console.warn(`⚠️ Redis rate limit check failed, falling back to in-memory: `, err.message)
    }
  }

  return checkRateLimitInMemory(key, config)
}
