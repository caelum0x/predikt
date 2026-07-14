// Limit-order routes. Follows the markets.ts conventions: {success, data?,
// error?} envelope, zod-validated bodies, Bearer auth via
// service.getAccountByKey. The public order book endpoint exposes anonymized
// price levels only — never account ids.

import { Hono } from 'hono'
import type { Context, MiddlewareHandler } from 'hono'
import { z } from 'zod'
import {
  MarketService,
  ServiceError,
  type Account,
} from '../engine/service'
import {
  MAX_LIMIT_PROB,
  MAX_ORDER_AMOUNT,
  MIN_LIMIT_PROB,
  MIN_ORDER_AMOUNT,
  ORDER_STATUSES,
} from '../engine/orders'

type ApiResponse<T> = { success: boolean; data?: T; error?: string }

type Env = { Variables: { account: Account } }

const placeOrderSchema = z.object({
  side: z.enum(['YES', 'NO']),
  limitProb: z.number().min(MIN_LIMIT_PROB).max(MAX_LIMIT_PROB),
  amount: z.number().min(MIN_ORDER_AMOUNT).max(MAX_ORDER_AMOUNT),
  answerId: z.string().trim().min(1).max(80).optional(),
})

const orderStatusSchema = z.enum(ORDER_STATUSES).optional()

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
    'order route unexpected error:',
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

export function createOrderRoutes(service: MarketService): Hono<Env> {
  const app = new Hono<Env>()

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

  // Public: the open order book as anonymized price levels.
  app.get('/markets/:id/orders', (c) => {
    try {
      return ok(c, { orders: service.getOrderBook(c.req.param('id')) })
    } catch (err) {
      return failFrom(c, err)
    }
  })

  // Authed: place a limit order. Funds are reserved immediately; a marketable
  // order starts filling in the same transaction.
  app.post('/markets/:id/orders', auth, async (c) => {
    const parsed = await parseBody(c, placeOrderSchema)
    if ('error' in parsed) return failFrom(c, new ServiceError(400, parsed.error))
    try {
      const result = service.placeOrder(
        c.get('account').id,
        c.req.param('id'),
        parsed.data
      )
      return ok(c, result, 201)
    } catch (err) {
      return failFrom(c, err)
    }
  })

  // Authed: the caller's own orders, optionally filtered by status.
  app.get('/accounts/me/orders', auth, (c) => {
    const status = orderStatusSchema.safeParse(c.req.query('status') || undefined)
    if (!status.success) {
      return failFrom(
        c,
        new ServiceError(400, 'status must be OPEN, FILLED, or CANCELLED.')
      )
    }
    try {
      return ok(c, {
        orders: service.listOrders(c.get('account').id, status.data),
      })
    } catch (err) {
      return failFrom(c, err)
    }
  })

  // Authed: cancel an OPEN order (owner only); refunds the unfilled amount.
  app.delete('/orders/:id', auth, (c) => {
    try {
      const result = service.cancelOrder(c.get('account').id, c.req.param('id'))
      return ok(c, result)
    } catch (err) {
      return failFrom(c, err)
    }
  })

  return app
}
