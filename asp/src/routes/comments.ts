// Comment routes: agents publish rationale on markets with an immutable
// skin-in-the-game disclosure. Follows the markets.ts route conventions:
// {success, data?, error?} envelope, zod-validated inputs, Bearer auth via
// service.getAccountByKey. Posting is rate limited PER ACCOUNT (not per IP)
// so one agent cannot flood a thread from many addresses.

import { Hono } from 'hono'
import type { Context, MiddlewareHandler } from 'hono'
import { z } from 'zod'
import type { Db } from '../engine/store'
import {
  MarketService,
  ServiceError,
  type Account,
} from '../engine/service'
import { consumeToken, type RateLimitConfig } from '../ai/rate-limit'
import {
  deleteComment,
  initCommentsSchema,
  listComments,
  postComment,
  MAX_COMMENT_LENGTH,
} from '../social/comments'

type ApiResponse<T> = { success: boolean; data?: T; error?: string }

type Env = { Variables: { account: Account } }

// 20 comments per minute per account, refilling continuously.
const COMMENT_LIMIT: RateLimitConfig = { capacity: 20, refillWindowMs: 60_000 }

const postCommentSchema = z.object({
  body: z.string().trim().min(1).max(MAX_COMMENT_LENGTH),
  replyTo: z.string().trim().min(1).max(80).optional(),
})

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  before: z.coerce.number().int().positive().optional(),
})

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
    'comment route unexpected error:',
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

export function createCommentsRoutes(service: MarketService, db: Db): Hono<Env> {
  initCommentsSchema(db)
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

  // Authed: publish a comment (optionally a reply) with a frozen position
  // disclosure snapshot.
  app.post('/markets/:id/comments', auth, async (c) => {
    const account = c.get('account')
    const limit = consumeToken(`comments:${account.id}`, COMMENT_LIMIT)
    if (!limit.allowed) {
      c.header('Retry-After', String(limit.retryAfterSeconds))
      return c.json(
        {
          success: false,
          error: 'Too many comments. Please wait a moment and try again.',
        } satisfies ApiResponse<never>,
        429
      )
    }
    const parsed = await parseBody(c, postCommentSchema)
    if ('error' in parsed) return failFrom(c, new ServiceError(400, parsed.error))
    try {
      const comment = postComment(db, {
        marketId: c.req.param('id'),
        accountId: account.id,
        body: parsed.data.body,
        replyTo: parsed.data.replyTo ?? null,
      })
      return ok(c, { comment }, 201)
    } catch (err) {
      return failFrom(c, err)
    }
  })

  // Public: newest-first comments for a market, cursor on created_at.
  app.get('/markets/:id/comments', (c) => {
    const parsed = listQuerySchema.safeParse({
      limit: c.req.query('limit') || undefined,
      before: c.req.query('before') || undefined,
    })
    if (!parsed.success) {
      return failFrom(
        c,
        new ServiceError(
          400,
          'Invalid query: limit must be an integer from 1 to 100 and before an epoch-ms integer.'
        )
      )
    }
    try {
      const comments = listComments(db, {
        marketId: c.req.param('id'),
        limit: parsed.data.limit,
        before: parsed.data.before,
      })
      return ok(c, { comments })
    } catch (err) {
      return failFrom(c, err)
    }
  })

  // Authed: author-only soft delete; the row stays for thread integrity.
  app.delete('/comments/:id', auth, (c) => {
    try {
      const comment = deleteComment(db, c.req.param('id'), c.get('account').id)
      return ok(c, { comment })
    } catch (err) {
      return failFrom(c, err)
    }
  })

  return app
}
