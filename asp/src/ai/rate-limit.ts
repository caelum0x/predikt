// Best-effort in-memory rate limiter for the tool routes (SERVER-ONLY).
//
// A small token-bucket keyed by client IP. Per-instance and reset on restart,
// so NOT a hard global guarantee — but enough to stop a single client from
// hammering the routes and burning OpenRouter credits.
//
// Ported from predikt (oracle/web/lib/ai/rate-limit.ts), made framework-free.

// Bucket capacity and refill. Defaults: 10 requests per 60s, refilling
// continuously so a caller regains ~1 token every 6s.
const CAPACITY = 10
const REFILL_WINDOW_MS = 60_000
const REFILL_PER_MS = CAPACITY / REFILL_WINDOW_MS

type Bucket = { tokens: number; updatedAt: number }

// Module-level map persists across requests within a single process.
const buckets = new Map<string, Bucket>()

// Occasionally prune idle buckets so the map can't grow unbounded.
const IDLE_TTL_MS = 5 * REFILL_WINDOW_MS
let lastSweep = 0

function sweep(now: number): void {
  if (now - lastSweep < IDLE_TTL_MS) return
  lastSweep = now
  for (const [key, bucket] of buckets) {
    if (now - bucket.updatedAt > IDLE_TTL_MS) buckets.delete(key)
  }
}

export type RateLimitResult = {
  allowed: boolean
  // Seconds until at least one token is available again (when not allowed).
  retryAfterSeconds: number
}

// Consume one token for `key`. Returns whether the request is allowed.
export function consumeToken(key: string): RateLimitResult {
  const now = Date.now()
  sweep(now)

  const existing = buckets.get(key)
  const bucket: Bucket = existing ?? { tokens: CAPACITY, updatedAt: now }

  // Refill based on elapsed time since last update, capped at CAPACITY.
  const elapsed = now - bucket.updatedAt
  const refilled = Math.min(CAPACITY, bucket.tokens + elapsed * REFILL_PER_MS)

  if (refilled >= 1) {
    buckets.set(key, { tokens: refilled - 1, updatedAt: now })
    return { allowed: true, retryAfterSeconds: 0 }
  }

  // Not enough tokens — keep the (refilled) balance and report wait time.
  buckets.set(key, { tokens: refilled, updatedAt: now })
  const needed = 1 - refilled
  const retryAfterSeconds = Math.ceil(needed / REFILL_PER_MS / 1000)
  return { allowed: false, retryAfterSeconds: Math.max(1, retryAfterSeconds) }
}

// Derive a best-effort client key from proxy headers. `getHeader` abstracts
// the framework (Hono: (name) => c.req.header(name)).
export function clientIpKey(
  getHeader: (name: string) => string | undefined
): string {
  const forwarded = getHeader('x-forwarded-for')
  const ip = forwarded?.split(',')[0]?.trim() || 'unknown'
  return `ip:${ip}`
}
