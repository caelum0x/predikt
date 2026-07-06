// Best-effort in-memory rate limiter for the AI API routes (SERVER-ONLY).
//
// A small token-bucket keyed by uid (or IP fallback). This is intentionally
// simple: on serverless it is per-instance and resets on cold start, so it is
// NOT a hard global guarantee — but it is enough to stop a single client from
// hammering the routes and burning OpenRouter credits within a warm instance.
// For a hard cross-instance limit you'd back this with a shared store (e.g.
// Redis); that is out of scope here.

import type { NextApiRequest } from 'next'

// Bucket capacity and refill. Defaults: 10 requests per 60s, refilling
// continuously so a caller regains ~1 token every 6s.
const CAPACITY = 10
const REFILL_WINDOW_MS = 60_000
const REFILL_PER_MS = CAPACITY / REFILL_WINDOW_MS

type Bucket = { tokens: number; updatedAt: number }

// Module-level map persists across requests within a single warm instance.
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

// Derive a best-effort client IP from proxy headers, falling back to the
// socket address. Used only when there is no authenticated uid.
export function clientIpKey(req: NextApiRequest): string {
  const forwarded = req.headers['x-forwarded-for']
  const first = Array.isArray(forwarded)
    ? forwarded[0]
    : forwarded?.split(',')[0]
  const ip = first?.trim() || req.socket.remoteAddress || 'unknown'
  return `ip:${ip}`
}
