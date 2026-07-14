// Public discovery routes: full-text market search, category aggregates, and
// trending markets. No auth (everything is derived, public data); /search is
// rate limited per client IP because it is the most expensive query.
// Follows the shared route conventions: {success, data?, error?} envelope and
// zod-validated query inputs.

import { Hono } from 'hono'
import type { Context } from 'hono'
import { z } from 'zod'
import type { Db } from '../engine/store'
import {
  clientIpKey,
  consumeToken,
  type RateLimitConfig,
} from '../ai/rate-limit'
import {
  initSearchSchema,
  listCategories,
  searchMarkets,
  trendingMarkets,
} from '../discovery/search'

type ApiResponse<T> = { success: boolean; data?: T; error?: string }

const SEARCH_RATE_LIMIT: RateLimitConfig = {
  capacity: 30,
  refillWindowMs: 60_000,
}

const searchQuerySchema = z.object({
  q: z.string().trim().min(2).max(200),
  status: z.enum(['OPEN', 'CLOSED', 'RESOLVED']).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})

const trendingQuerySchema = z.object({
  hours: z.coerce.number().int().min(1).max(168).default(24),
  limit: z.coerce.number().int().min(1).max(50).default(10),
})

function ok<T>(c: Context, data: T) {
  return c.json({ success: true, data } satisfies ApiResponse<T>, 200)
}

function fail(c: Context, status: 400 | 429 | 500, error: string) {
  return c.json({ success: false, error } satisfies ApiResponse<never>, status)
}

function failUnexpected(c: Context, route: string, err: unknown) {
  console.error(
    `${route} unexpected error:`,
    err instanceof Error ? err.message : 'unknown error'
  )
  return fail(c, 500, 'Unexpected server error.')
}

// The Node adapter exposes the raw IncomingMessage on c.env; in tests
// (app.request) there is no socket, so this returns undefined and the rate
// limiter falls back to a single shared bucket.
function socketAddressOf(c: Context): string | undefined {
  const env = c.env as
    | { incoming?: { socket?: { remoteAddress?: string } } }
    | undefined
  return env?.incoming?.socket?.remoteAddress
}

export type DiscoveryRouteOptions = {
  // Trust X-Forwarded-For / Fly-Client-IP for the rate-limit key. Enable only
  // behind a reverse proxy you control (same flag app.ts derives from
  // TRUST_PROXY).
  trustProxyHeader?: boolean
}

export function createDiscoveryRoutes(
  db: Db,
  options: DiscoveryRouteOptions = {}
): Hono {
  // Chooses FTS vs LIKE mode once for this Db and creates the FTS schema
  // idempotently (no-op if another caller already initialized it).
  initSearchSchema(db)

  const trustProxyHeader = options.trustProxyHeader ?? false
  const app = new Hono()

  // GET /search?q=&status=&limit= — ranked full-text search, rate limited.
  app.get('/search', (c) => {
    const key = `search:${clientIpKey((name) => c.req.header(name), {
      trustProxyHeader,
      socketAddress: socketAddressOf(c),
    })}`
    const limit = consumeToken(key, SEARCH_RATE_LIMIT)
    if (!limit.allowed) {
      c.header('Retry-After', String(limit.retryAfterSeconds))
      return fail(c, 429, 'Too many requests. Please wait a moment and try again.')
    }

    const parsed = searchQuerySchema.safeParse({
      q: c.req.query('q'),
      status: c.req.query('status') || undefined,
      limit: c.req.query('limit') || undefined,
    })
    if (!parsed.success) {
      return fail(
        c,
        400,
        'Invalid query: q must be 2-200 characters, status one of OPEN|CLOSED|RESOLVED, limit an integer from 1 to 50.'
      )
    }

    try {
      const results = searchMarkets(db, parsed.data)
      return ok(c, { query: parsed.data.q, results })
    } catch (err) {
      return failUnexpected(c, 'search', err)
    }
  })

  // GET /categories — per-category market counts and volume.
  app.get('/categories', (c) => {
    try {
      return ok(c, { categories: listCategories(db) })
    } catch (err) {
      return failUnexpected(c, 'categories', err)
    }
  })

  // GET /trending?hours=&limit= — most-traded markets within the window.
  app.get('/trending', (c) => {
    const parsed = trendingQuerySchema.safeParse({
      hours: c.req.query('hours') || undefined,
      limit: c.req.query('limit') || undefined,
    })
    if (!parsed.success) {
      return fail(
        c,
        400,
        'Invalid query: hours must be an integer from 1 to 168 and limit an integer from 1 to 50.'
      )
    }
    try {
      return ok(c, {
        hours: parsed.data.hours,
        markets: trendingMarkets(db, parsed.data),
      })
    } catch (err) {
      return failUnexpected(c, 'trending', err)
    }
  })

  return app
}
