// Market + account routes. Authentication is a Bearer API key issued at
// account creation; the key is hashed at rest and never logged.

import { Hono } from 'hono'
import type { Context, MiddlewareHandler } from 'hono'
import { z } from 'zod'
import {
  MarketService,
  ServiceError,
  type Account,
} from '../engine/service'

type ApiResponse<T> = { success: boolean; data?: T; error?: string }

type Env = { Variables: { account: Account } }

const createAccountSchema = z.object({ name: z.string().trim().min(2).max(80) })

const createMarketSchema = z.object({
  question: z.string().trim().min(8).max(240),
  criteria: z.string().trim().min(10).max(2000),
  description: z.string().trim().max(4000).optional(),
  category: z.string().trim().min(2).max(60).optional(),
  closeTime: z.number().int().positive(),
  initialProb: z.number().min(0.02).max(0.98).optional(),
  subsidy: z.number().min(10).max(100_000).optional(),
  outcomeType: z.enum(['BINARY', 'MULTI']).optional(),
  answers: z.array(z.string().trim().min(1).max(120)).min(2).max(12).optional(),
})

const tradeSchema = z.object({
  side: z.enum(['YES', 'NO']),
  amount: z.number().positive().max(1_000_000),
  answerId: z.string().trim().min(1).max(80).optional(),
})

const sellSchema = z.object({
  side: z.enum(['YES', 'NO']),
  shares: z.number().positive().max(10_000_000),
  answerId: z.string().trim().min(1).max(80).optional(),
})

// BINARY: YES | NO | CANCEL. MULTI: the winning answerId or CANCEL. The
// service validates the value against the market's outcome type.
const resolveSchema = z.object({ outcome: z.string().trim().min(1).max(80) })

const statusSchema = z.enum(['OPEN', 'CLOSED', 'RESOLVED']).optional()

function ok<T>(c: Context, data: T, status: 200 | 201 = 200) {
  return c.json({ success: true, data } satisfies ApiResponse<T>, status)
}

function failFrom(c: Context, err: unknown) {
  if (err instanceof ServiceError) {
    return c.json(
      { success: false, error: err.message } satisfies ApiResponse<never>,
      err.status
    )
  }
  console.error(
    'market route unexpected error:',
    err instanceof Error ? err.message : 'unknown error'
  )
  return c.json(
    { success: false, error: 'Unexpected server error.' } satisfies ApiResponse<never>,
    500
  )
}

async function parseBody<T>(
  c: Context,
  schema: z.ZodType<T>
): Promise<{ data: T } | { error: string }> {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return { error: 'Request body must be JSON.' }
  }
  const result = schema.safeParse(body)
  if (!result.success) {
    return { error: result.error.issues[0]?.message ?? 'Invalid request.' }
  }
  return { data: result.data }
}

export function createMarketRoutes(service: MarketService): Hono<Env> {
  const app = new Hono<Env>()

  // Public: create an account. Returns the API key ONCE.
  app.post('/accounts', async (c) => {
    const parsed = await parseBody(c, createAccountSchema)
    if ('error' in parsed) return failFrom(c, new ServiceError(400, parsed.error))
    try {
      const { account, apiKey } = service.createAccount(parsed.data.name)
      return ok(c, { account, apiKey }, 201)
    } catch (err) {
      return failFrom(c, err)
    }
  })

  // Public: browse markets.
  app.get('/markets', (c) => {
    const status = statusSchema.safeParse(
      c.req.query('status') || undefined
    )
    if (!status.success) {
      return failFrom(c, new ServiceError(400, 'Invalid status filter.'))
    }
    return ok(c, { markets: service.listMarkets(status.data) })
  })

  app.get('/markets/:id', (c) => {
    try {
      return ok(c, { market: service.getMarket(c.req.param('id')) })
    } catch (err) {
      return failFrom(c, err)
    }
  })

  // Public: price a hypothetical buy without executing it. MULTI markets
  // additionally require &answerId=ans_...
  app.get('/markets/:id/quote', (c) => {
    const side = c.req.query('side')
    const amount = Number(c.req.query('amount'))
    const answerId = c.req.query('answerId') || undefined
    if ((side !== 'YES' && side !== 'NO') || !Number.isFinite(amount) || amount <= 0) {
      return failFrom(
        c,
        new ServiceError(400, 'Provide side=YES|NO and a positive amount.')
      )
    }
    try {
      return ok(c, {
        quote: service.quote(c.req.param('id'), side, amount, answerId),
      })
    } catch (err) {
      return failFrom(c, err)
    }
  })

  // Authenticated routes carry this middleware explicitly, so public routes
  // (and unrelated routes on the parent app) are never intercepted.
  const auth: MiddlewareHandler<Env> = async (c, next) => {
    const header = c.req.header('Authorization') ?? ''
    const key = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
    const account = key ? service.getAccountByKey(key) : null
    if (!account) {
      return failFrom(
        c,
        new ServiceError(401, 'Provide a valid API key: Authorization: Bearer pk_...')
      )
    }
    c.set('account', account)
    await next()
  }

  app.get('/accounts/me', auth, (c) => {
    const account = c.get('account')
    return ok(c, {
      account: service.getAccount(account.id),
      positions: service.getPositions(account.id),
    })
  })

  app.post('/markets', auth, async (c) => {
    const parsed = await parseBody(c, createMarketSchema)
    if ('error' in parsed) return failFrom(c, new ServiceError(400, parsed.error))
    try {
      const market = service.createMarket(c.get('account').id, parsed.data)
      return ok(c, { market }, 201)
    } catch (err) {
      return failFrom(c, err)
    }
  })

  app.post('/markets/:id/buy', auth, async (c) => {
    const parsed = await parseBody(c, tradeSchema)
    if ('error' in parsed) return failFrom(c, new ServiceError(400, parsed.error))
    try {
      const trade = service.buy(
        c.get('account').id,
        c.req.param('id'),
        parsed.data.side,
        parsed.data.amount,
        parsed.data.answerId
      )
      return ok(c, { trade })
    } catch (err) {
      return failFrom(c, err)
    }
  })

  app.post('/markets/:id/sell', auth, async (c) => {
    const parsed = await parseBody(c, sellSchema)
    if ('error' in parsed) return failFrom(c, new ServiceError(400, parsed.error))
    try {
      const trade = service.sell(
        c.get('account').id,
        c.req.param('id'),
        parsed.data.side,
        parsed.data.shares,
        parsed.data.answerId
      )
      return ok(c, { trade })
    } catch (err) {
      return failFrom(c, err)
    }
  })

  app.post('/markets/:id/close', auth, async (c) => {
    try {
      const market = service.closeMarket(c.get('account').id, c.req.param('id'))
      return ok(c, { market })
    } catch (err) {
      return failFrom(c, err)
    }
  })

  app.post('/markets/:id/resolve', auth, async (c) => {
    const parsed = await parseBody(c, resolveSchema)
    if ('error' in parsed) return failFrom(c, new ServiceError(400, parsed.error))
    try {
      const market = service.resolveMarket(
        c.get('account').id,
        c.req.param('id'),
        parsed.data.outcome
      )
      return ok(c, { market })
    } catch (err) {
      return failFrom(c, err)
    }
  })

  return app
}
