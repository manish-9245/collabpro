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
