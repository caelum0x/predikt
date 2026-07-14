// Tests for market comments: thread lifecycle, the immutable skin-in-the-game
// disclosure snapshot (trades AFTER commenting must not rewrite it), reply
// integrity across markets, author-only soft delete, per-account rate
// limiting, zod validation, and cursor pagination. Everything drives the real
// MarketService on an in-memory DB.

import { beforeEach, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { openDb, type Db } from '../src/engine/store'
import { MarketService } from '../src/engine/service'
import { createCommentsRoutes } from '../src/routes/comments'
import { initCommentsSchema } from '../src/social/comments'

let db: Db
let service: MarketService
let app: Hono

beforeEach(() => {
  db = openDb(':memory:')
  service = new MarketService(db)
  app = new Hono()
  app.route('/', createCommentsRoutes(service, db))
})

const FUTURE = () => Date.now() + 7 * 24 * 60 * 60 * 1000

function makeMarket(
  creatorId: string,
  question = 'Will BTC close above $150k on Dec 31, 2026?'
) {
  return service.createMarket(creatorId, {
    question,
    criteria: 'Resolves YES on a CoinGecko daily close above the threshold.',
    closeTime: FUTURE(),
    subsidy: 100,
  })
}

function makeMultiMarket(creatorId: string) {
  return service.createMarket(creatorId, {
    question: 'Which model tops the leaderboard on Dec 31, 2026?',
    criteria: 'Resolves to the top model on the public leaderboard snapshot.',
    closeTime: FUTURE(),
    subsidy: 90,
    outcomeType: 'MULTI',
    answers: ['Model A', 'Model B', 'Model C'],
  })
}

function post(path: string, body: unknown, key?: string) {
  return app.request(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

function get(path: string) {
  return app.request(path)
}

function del(path: string, key?: string) {
  return app.request(path, {
    method: 'DELETE',
    headers: key ? { Authorization: `Bearer ${key}` } : {},
  })
}

async function json(res: Response) {
  return (await res.json()) as { success: boolean; data?: any; error?: string }
}

function setCommentTime(commentId: string, ts: number) {
  db.prepare('UPDATE comments SET created_at = ? WHERE id = ?').run(ts, commentId)
}

describe('initCommentsSchema', () => {
  it('is idempotent', () => {
    expect(() => {
      initCommentsSchema(db)
      initCommentsSchema(db)
    }).not.toThrow()
  })
})

describe('POST /markets/:id/comments', () => {
  it('requires a valid API key', async () => {
    const alice = service.createAccount('alice-agent')
    const market = makeMarket(alice.account.id)
    const res = await post(`/markets/${market.id}/comments`, { body: 'hi there' })
    expect(res.status).toBe(401)
    expect((await json(res)).success).toBe(false)
  })

  it('returns 404 for an unknown market', async () => {
    const alice = service.createAccount('alice-agent')
    const res = await post(
      '/markets/mkt_nope/comments',
      { body: 'ghost market' },
      alice.apiKey
    )
    expect(res.status).toBe(404)
  })

  it('publishes a comment with a zero disclosure when the author holds nothing', async () => {
    const alice = service.createAccount('alice-agent')
    const market = makeMarket(alice.account.id)
    const bob = service.createAccount('bob-agent')

    const res = await post(
      `/markets/${market.id}/comments`,
      { body: 'No position yet, just watching.' },
      bob.apiKey
    )
    expect(res.status).toBe(201)
    const { comment } = (await json(res)).data
    expect(comment).toMatchObject({
      marketId: market.id,
      accountId: bob.account.id,
      accountName: 'bob-agent',
      body: 'No position yet, just watching.',
      replyTo: null,
      position: { yesShares: 0, noShares: 0, invested: 0 },
    })
    expect(typeof comment.id).toBe('string')
    expect(typeof comment.createdAt).toBe('number')
  })

  it('freezes the disclosure snapshot: trades after commenting do not change it', async () => {
    const alice = service.createAccount('alice-agent')
    const market = makeMarket(alice.account.id)
    const bob = service.createAccount('bob-agent')

    const trade = service.buy(bob.account.id, market.id, 'YES', 50)
    const res = await post(
      `/markets/${market.id}/comments`,
      { body: 'Long YES with conviction.' },
      bob.apiKey
    )
    const { comment } = (await json(res)).data
    // Cost basis excludes the 1% creator fee: 50 - 0.5 = 49.5.
    expect(comment.position).toEqual({
      yesShares: trade.shares,
      noShares: 0,
      invested: 49.5,
    })

    // A later trade changes the live position but must NOT rewrite history.
    service.buy(bob.account.id, market.id, 'YES', 100)
    const listed = (await json(await get(`/markets/${market.id}/comments`))).data
      .comments
    expect(listed).toHaveLength(1)
    expect(listed[0].position).toEqual({
      yesShares: trade.shares,
      noShares: 0,
      invested: 49.5,
    })
    // Sanity: the live position really did move past the snapshot.
    const live = service
      .getPositions(bob.account.id)
      .filter((p) => p.marketId === market.id)
      .reduce((sum, p) => sum + p.yesShares, 0)
    expect(live).toBeGreaterThan(trade.shares)
  })

  it('aggregates the disclosure across answers on MULTI markets', async () => {
    const alice = service.createAccount('alice-agent')
    const market = makeMultiMarket(alice.account.id)
    const bob = service.createAccount('bob-agent')
    const answers = market.answers!
    const tA = service.buy(bob.account.id, market.id, 'YES', 20, answers[0]!.id)
    const tB = service.buy(bob.account.id, market.id, 'NO', 30, answers[1]!.id)

    const res = await post(
      `/markets/${market.id}/comments`,
      { body: 'Spread across two answers.' },
      bob.apiKey
    )
    const { comment } = (await json(res)).data
    expect(comment.position.yesShares).toBeCloseTo(tA.shares, 6)
    expect(comment.position.noShares).toBeCloseTo(tB.shares, 6)
    // Invested nets both answers' cost bases: (20 - 0.2) + (30 - 0.3).
    expect(comment.position.invested).toBeCloseTo(49.5, 6)
  })

  it('accepts a reply to a comment on the same market', async () => {
    const alice = service.createAccount('alice-agent')
    const market = makeMarket(alice.account.id)
    const bob = service.createAccount('bob-agent')

    const parent = (
      await json(
        await post(`/markets/${market.id}/comments`, { body: 'Thesis.' }, alice.apiKey)
      )
    ).data.comment
    const res = await post(
      `/markets/${market.id}/comments`,
      { body: 'Counterpoint.', replyTo: parent.id },
      bob.apiKey
    )
    expect(res.status).toBe(201)
    expect((await json(res)).data.comment.replyTo).toBe(parent.id)
  })

  it('rejects a replyTo that belongs to a different market', async () => {
    const alice = service.createAccount('alice-agent')
    const marketA = makeMarket(alice.account.id, 'Will ETH close above $10k on Dec 31, 2026?')
    const marketB = makeMarket(alice.account.id)

    const onA = (
      await json(
        await post(`/markets/${marketA.id}/comments`, { body: 'On market A.' }, alice.apiKey)
      )
    ).data.comment
    const res = await post(
      `/markets/${marketB.id}/comments`,
      { body: 'Cross-market reply.', replyTo: onA.id },
      alice.apiKey
    )
    expect(res.status).toBe(400)
    expect((await json(res)).error).toMatch(/different market/i)
  })

  it('rejects a replyTo that does not exist', async () => {
    const alice = service.createAccount('alice-agent')
    const market = makeMarket(alice.account.id)
    const res = await post(
      `/markets/${market.id}/comments`,
      { body: 'Replying to a ghost.', replyTo: 'cmt_nope' },
      alice.apiKey
    )
    expect(res.status).toBe(400)
    expect((await json(res)).error).toMatch(/not found/i)
  })

  it('zod-validates the body: empty, oversized, wrong types, non-JSON', async () => {
    const alice = service.createAccount('alice-agent')
    const market = makeMarket(alice.account.id)
    const path = `/markets/${market.id}/comments`

    expect((await post(path, { body: '' }, alice.apiKey)).status).toBe(400)
    expect((await post(path, { body: '   ' }, alice.apiKey)).status).toBe(400)
    expect(
      (await post(path, { body: 'x'.repeat(2001) }, alice.apiKey)).status
    ).toBe(400)
    expect((await post(path, { body: 42 }, alice.apiKey)).status).toBe(400)
    expect(
      (await post(path, { body: 'ok body', replyTo: 7 }, alice.apiKey)).status
    ).toBe(400)
    expect((await post(path, {}, alice.apiKey)).status).toBe(400)

    const raw = await app.request(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${alice.apiKey}`,
      },
      body: 'not json',
    })
    expect(raw.status).toBe(400)

    // A 2000-char body is exactly at the limit and accepted.
    expect(
      (await post(path, { body: 'y'.repeat(2000) }, alice.apiKey)).status
    ).toBe(201)
  })

  it('rate limits per account: 20 comments per minute, then 429', async () => {
    const alice = service.createAccount('alice-agent')
    const market = makeMarket(alice.account.id)
    const bob = service.createAccount('bob-agent')
    const path = `/markets/${market.id}/comments`

    for (let i = 0; i < 20; i++) {
      const res = await post(path, { body: `comment ${i}` }, bob.apiKey)
      expect(res.status).toBe(201)
    }
    const limited = await post(path, { body: 'one too many' }, bob.apiKey)
    expect(limited.status).toBe(429)
    expect((await json(limited)).success).toBe(false)
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0)

    // The bucket is per account, not per market or per IP: a different
    // account still posts freely.
    const other = await post(path, { body: 'fresh account' }, alice.apiKey)
    expect(other.status).toBe(201)
  })
})

describe('GET /markets/:id/comments', () => {
  it('returns 404 for an unknown market', async () => {
    const res = await get('/markets/mkt_nope/comments')
    expect(res.status).toBe(404)
  })

  it('lists newest first with the documented shape', async () => {
    const alice = service.createAccount('alice-agent')
    const market = makeMarket(alice.account.id)
    const bob = service.createAccount('bob-agent')

    const first = (
      await json(await post(`/markets/${market.id}/comments`, { body: 'First.' }, alice.apiKey))
    ).data.comment
    const second = (
      await json(
        await post(
          `/markets/${market.id}/comments`,
          { body: 'Second.', replyTo: first.id },
          bob.apiKey
        )
      )
    ).data.comment
    setCommentTime(first.id, 1000)
    setCommentTime(second.id, 2000)

    const body = await json(await get(`/markets/${market.id}/comments`))
    expect(body.success).toBe(true)
    const comments = body.data.comments
    expect(comments.map((c: any) => c.id)).toEqual([second.id, first.id])
    expect(comments[1]).toMatchObject({
      id: first.id,
      accountId: alice.account.id,
      accountName: 'alice-agent',
      body: 'First.',
      replyTo: null,
      position: { yesShares: 0, noShares: 0, invested: 0 },
      createdAt: 1000,
    })
    expect(comments[0].replyTo).toBe(first.id)
  })

  it('paginates with limit and a before cursor', async () => {
    const alice = service.createAccount('alice-agent')
    const market = makeMarket(alice.account.id)
    const ids: string[] = []
    for (let i = 0; i < 5; i++) {
      const comment = (
        await json(
          await post(`/markets/${market.id}/comments`, { body: `c${i}` }, alice.apiKey)
        )
      ).data.comment
      setCommentTime(comment.id, (i + 1) * 1000)
      ids.push(comment.id)
    }

    const page1 = await json(await get(`/markets/${market.id}/comments?limit=2`))
    expect(page1.data.comments.map((c: any) => c.id)).toEqual([ids[4], ids[3]])

    const cursor = page1.data.comments[1].createdAt
    const page2 = await json(
      await get(`/markets/${market.id}/comments?limit=2&before=${cursor}`)
    )
    expect(page2.data.comments.map((c: any) => c.id)).toEqual([ids[2], ids[1]])
  })

  it('rejects invalid pagination queries', async () => {
    const alice = service.createAccount('alice-agent')
    const market = makeMarket(alice.account.id)
    expect((await get(`/markets/${market.id}/comments?limit=0`)).status).toBe(400)
    expect((await get(`/markets/${market.id}/comments?limit=101`)).status).toBe(400)
    expect((await get(`/markets/${market.id}/comments?limit=abc`)).status).toBe(400)
    expect((await get(`/markets/${market.id}/comments?before=nope`)).status).toBe(400)
  })
})

describe('DELETE /comments/:id', () => {
  async function seedComment() {
    const alice = service.createAccount('alice-agent')
    const market = makeMarket(alice.account.id)
    const bob = service.createAccount('bob-agent')
    service.buy(bob.account.id, market.id, 'YES', 50)
    const comment = (
      await json(
        await post(`/markets/${market.id}/comments`, { body: 'Hot take.' }, bob.apiKey)
      )
    ).data.comment
    return { alice, bob, market, comment }
  }

  it('requires a valid API key', async () => {
    const { comment } = await seedComment()
    expect((await del(`/comments/${comment.id}`)).status).toBe(401)
  })

  it('returns 404 for an unknown comment', async () => {
    const alice = service.createAccount('alice-agent')
    expect((await del('/comments/cmt_nope', alice.apiKey)).status).toBe(404)
  })

  it('only the author can delete', async () => {
    const { alice, comment } = await seedComment()
    const res = await del(`/comments/${comment.id}`, alice.apiKey)
    expect(res.status).toBe(403)
  })

  it('soft deletes: scrubbed body, zeroed position, row retained for threads', async () => {
    const { bob, market, comment } = await seedComment()
    // A reply that must survive the parent's deletion.
    const reply = (
      await json(
        await post(
          `/markets/${market.id}/comments`,
          { body: 'Replying before deletion.', replyTo: comment.id },
          bob.apiKey
        )
      )
    ).data.comment
    setCommentTime(comment.id, 1000)
    setCommentTime(reply.id, 2000)

    const res = await del(`/comments/${comment.id}`, bob.apiKey)
    expect(res.status).toBe(200)
    const deleted = (await json(res)).data.comment
    expect(deleted.body).toBe('[deleted]')
    expect(deleted.position).toEqual({ yesShares: 0, noShares: 0, invested: 0 })

    const listed = (await json(await get(`/markets/${market.id}/comments`))).data
      .comments
    expect(listed).toHaveLength(2)
    expect(listed[1]).toMatchObject({
      id: comment.id,
      body: '[deleted]',
      position: { yesShares: 0, noShares: 0, invested: 0 },
    })
    // The reply still points at the retained parent row.
    expect(listed[0]).toMatchObject({ id: reply.id, replyTo: comment.id })

    const row = db
      .prepare('SELECT is_deleted, body FROM comments WHERE id = ?')
      .get(comment.id) as { is_deleted: number; body: string }
    expect(row.is_deleted).toBe(1)
    expect(row.body).toBe('[deleted]')
  })

  it('rejects deleting an already-deleted comment', async () => {
    const { bob, comment } = await seedComment()
    expect((await del(`/comments/${comment.id}`, bob.apiKey)).status).toBe(200)
    expect((await del(`/comments/${comment.id}`, bob.apiKey)).status).toBe(409)
  })
})
