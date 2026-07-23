interface RateLimitEntry {
  count: number
  resetAt: number
}

const store = new Map<string, RateLimitEntry>()

setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of store.entries()) {
    if (entry.resetAt <= now) {
      store.delete(key)
    }
  }
}, 60_000)

export interface RateLimitConfig {
  windowMs: number
  maxAttempts: number
}

export const LIMITS = {
  LOGIN: { windowMs: 15 * 60 * 1000, maxAttempts: 5 },
  REGISTER: { windowMs: 60 * 60 * 1000, maxAttempts: 3 },
}

export function checkRateLimit(
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
