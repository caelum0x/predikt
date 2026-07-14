// End-to-end HTTP tests for the market API: two agents sign up, one creates
// a market, the other trades it, the creator resolves, winnings arrive.
// Uses an in-memory DB and a fake AI completion — no network, no disk.

import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { openDb } from '../src/engine/store'
import { SIGNUP_GRANT } from '../src/engine/service'

type App = ReturnType<typeof createApp>

let app: App

function req(
  path: string,
  options: { method?: string; body?: unknown; key?: string } = {}
) {
  return app.request(path, {
    method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
    headers: {
      'Content-Type': 'application/json',
      ...(options.key ? { Authorization: `Bearer ${options.key}` } : {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  })
}

async function json(res: Response) {
  return (await res.json()) as { success: boolean; data?: any; error?: string }
}

async function signup(name: string): Promise<{ id: string; key: string }> {
  const res = await req('/accounts', { body: { name } })
  const body = await json(res)
  return { id: body.data.account.id, key: body.data.apiKey }
}

const FUTURE = () => Date.now() + 7 * 24 * 60 * 60 * 1000

async function createMarket(key: string) {
  const res = await req('/markets', {
    key,
    body: {
      question: 'Will BTC close above $150k on Dec 31, 2026?',
      criteria: 'Resolves YES on a CoinGecko daily close above $150,000.',
      closeTime: FUTURE(),
      subsidy: 100,
    },
  })
  return (await json(res)).data.market
}

beforeEach(() => {
  app = createApp({
    db: openDb(':memory:'),
    complete: async () => '{}',
  })
})

describe('account lifecycle', () => {
  it('creates an account, returns the key once, and reports balance', async () => {
    const res = await req('/accounts', { body: { name: 'trader-agent' } })
    expect(res.status).toBe(201)
    const body = await json(res)
    expect(body.data.apiKey).toMatch(/^pk_/)
    expect(body.data.account.balance).toBe(SIGNUP_GRANT)

    const me = await json(await req('/accounts/me', { key: body.data.apiKey }))
    expect(me.data.account.id).toBe(body.data.account.id)
  })

  it('rejects protected routes without a valid key', async () => {
    expect((await req('/accounts/me')).status).toBe(401)
    expect((await req('/accounts/me', { key: 'pk_bogus' })).status).toBe(401)
  })
})

describe('market lifecycle over HTTP', () => {
  it('runs the full journey: create → quote → buy → resolve → payout', async () => {
    const alice = await signup('alice-agent')
    const bob = await signup('bob-agent')
    const market = await createMarket(alice.key)
    expect(market.status).toBe('OPEN')
    expect(market.probability).toBeCloseTo(0.5, 6)

    // Public browsing works without a key.
    const listing = await json(await req('/markets'))
    expect(listing.data.markets).toHaveLength(1)

    // Quote matches the executed trade.
    const quote = (
      await json(await req(`/markets/${market.id}/quote?side=YES&amount=50`))
    ).data.quote
    const trade = (
      await json(
        await req(`/markets/${market.id}/buy`, {
          key: bob.key,
          body: { side: 'YES', amount: 50 },
        })
      )
    ).data.trade
    expect(trade.shares).toBeCloseTo(quote.shares, 6)
    expect(trade.probAfter).toBeGreaterThan(0.5)

    // Only the creator can resolve.
    const forbidden = await req(`/markets/${market.id}/resolve`, {
      key: bob.key,
      body: { outcome: 'YES' },
    })
    expect(forbidden.status).toBe(403)

    const resolved = await json(
      await req(`/markets/${market.id}/resolve`, {
        key: alice.key,
        body: { outcome: 'YES' },
      })
    )
    expect(resolved.data.market.status).toBe('RESOLVED')

    // Bob's payout: grant - 50 stake + winning shares (each pays 1).
    const me = await json(await req('/accounts/me', { key: bob.key }))
    expect(me.data.account.balance).toBeCloseTo(
      SIGNUP_GRANT - 50 + trade.shares,
      4
    )
  })

  it('rejects trading beyond the balance and selling unheld shares', async () => {
    const alice = await signup('alice-agent')
    const bob = await signup('bob-agent')
    const market = await createMarket(alice.key)

    const broke = await req(`/markets/${market.id}/buy`, {
      key: bob.key,
      body: { side: 'YES', amount: 999_999 },
    })
    expect(broke.status).toBe(402)

    const unheld = await req(`/markets/${market.id}/sell`, {
      key: bob.key,
      body: { side: 'NO', shares: 10 },
    })
    expect(unheld.status).toBe(400)
  })

  it('validates market creation input', async () => {
    const alice = await signup('alice-agent')
    const res = await req('/markets', {
      key: alice.key,
      body: { question: 'short', criteria: 'too short', closeTime: 0 },
    })
    expect(res.status).toBe(400)
  })
})

describe('MULTI market lifecycle over HTTP', () => {
  async function createMultiMarket(key: string) {
    const res = await req('/markets', {
      key,
      body: {
        question: 'Which chain wins the most agent deployments in 2026?',
        criteria: 'Resolves to the chain leading the public deployment index.',
        closeTime: FUTURE(),
        subsidy: 60,
        outcomeType: 'MULTI',
        answers: ['X Layer', 'Base', 'Solana'],
      },
    })
    expect(res.status).toBe(201)
    return (await json(res)).data.market
  }

  it('creates, quotes, buys, sells, and resolves a MULTI market', async () => {
    const alice = await signup('alice-agent')
    const bob = await signup('bob-agent')
    const market = await createMultiMarket(alice.key)

    expect(market.outcomeType).toBe('MULTI')
    expect(market.answers).toHaveLength(3)
    for (const answer of market.answers) {
      expect(answer.probability).toBeCloseTo(1 / 3, 6)
    }

    // Detail includes answers with per-answer probabilities.
    const detail = (await json(await req(`/markets/${market.id}`))).data.market
    expect(detail.answers.map((a: any) => a.text)).toEqual([
      'X Layer',
      'Base',
      'Solana',
    ])

    const target = market.answers[1]
    const quote = (
      await json(
        await req(
          `/markets/${market.id}/quote?side=YES&amount=50&answerId=${target.id}`
        )
      )
    ).data.quote
    const trade = (
      await json(
        await req(`/markets/${market.id}/buy`, {
          key: bob.key,
          body: { side: 'YES', amount: 50, answerId: target.id },
        })
      )
    ).data.trade
    expect(trade.shares).toBeCloseTo(quote.shares, 6)
    expect(trade.answerId).toBe(target.id)

    const sell = await req(`/markets/${market.id}/sell`, {
      key: bob.key,
      body: { side: 'YES', shares: 1, answerId: target.id },
    })
    expect(sell.status).toBe(200)

    // Resolve to the winning answer id; bob's remaining YES shares pay 1.
    const resolved = await json(
      await req(`/markets/${market.id}/resolve`, {
        key: alice.key,
        body: { outcome: target.id },
      })
    )
    expect(resolved.data.market.status).toBe('RESOLVED')
    expect(resolved.data.market.outcome).toBe(target.id)
  })

  it('rejects MULTI trades without an answerId and answerIds on binary markets', async () => {
    const alice = await signup('alice-agent')
    const bob = await signup('bob-agent')
    const multi = await createMultiMarket(alice.key)
    const binary = await createMarket(alice.key)

    const noAnswer = await req(`/markets/${multi.id}/buy`, {
      key: bob.key,
      body: { side: 'YES', amount: 10 },
    })
    expect(noAnswer.status).toBe(400)
    expect((await json(noAnswer)).error).toContain('answerId')

    const badQuote = await req(
      `/markets/${multi.id}/quote?side=YES&amount=10&answerId=ans_bogus`
    )
    expect(badQuote.status).toBe(400)

    const binaryWithAnswer = await req(`/markets/${binary.id}/buy`, {
      key: bob.key,
      body: { side: 'YES', amount: 10, answerId: multi.answers[0].id },
    })
    expect(binaryWithAnswer.status).toBe(400)
    expect((await json(binaryWithAnswer)).error).toContain('MULTI')
  })

  it('rejects invalid MULTI creation payloads and resolve outcomes', async () => {
    const alice = await signup('alice-agent')

    const oneAnswer = await req('/markets', {
      key: alice.key,
      body: {
        question: 'Which single option wins this malformed market?',
        criteria: 'Resolves to the announced winner of the event.',
        closeTime: FUTURE(),
        outcomeType: 'MULTI',
        answers: ['only-one'],
      },
    })
    expect(oneAnswer.status).toBe(400)

    const multi = await createMultiMarket(alice.key)
    const badOutcome = await req(`/markets/${multi.id}/resolve`, {
      key: alice.key,
      body: { outcome: 'YES' },
    })
    expect(badOutcome.status).toBe(400)
    expect((await json(badOutcome)).error).toContain('answerId')
  })
})
