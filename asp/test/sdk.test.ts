// The SDK exercised against the REAL app in-process (no network): every client
// method routes through createApp's Hono handler, and the x402 deposit path
// signs a genuine EIP-3009 authorization with a viem key and completes a
// verify-only deposit end to end.

import { Hono } from 'hono'
import { privateKeyToAccount } from 'viem/accounts'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { openDb, type Db } from '../src/engine/store'
import { MarketService } from '../src/engine/service'
import { createMarketRoutes } from '../src/routes/markets'
import { createDepositRoutes } from '../src/routes/deposits'
import type { X402Config } from '../src/payments/config'
import type { ChatCompletionFn } from '../src/ai/openrouter'
import {
  PrediktClient,
  PrediktApiError,
  type FetchLike,
} from '../src/sdk/client'
import { buildPaymentHeader } from '../src/sdk/x402-signer'

const BASE = 'http://sdk.test'
const FUTURE = () => Date.now() + 30 * 24 * 60 * 60 * 1000

// Deterministic AI completion keyed off the system prompt.
const complete: ChatCompletionFn = async ({ messages }) => {
  const sys = messages.find((m) => m.role === 'system')?.content ?? ''
  if (sys.includes('superforecaster')) {
    return JSON.stringify({
      probability: 0.6,
      confidence: 'medium',
      rationale: 'Base rate adjusted for the specifics of this question.',
      baseRate: 'Comparable events resolved YES ~60% of the time.',
      keyDrivers: ['Momentum', 'Sentiment'],
      updateTriggers: ['New data release'],
      citations: [],
    })
  }
  if (sys.includes('resolver')) {
    return JSON.stringify({
      verdict: 'YES',
      confidence: 0.85,
      rationale: 'The provided source confirms the outcome.',
      citations: ['[1]'],
    })
  }
  return JSON.stringify({
    drafts: [
      {
        question: 'Will the sample event happen by 2027?',
        description: 'Drafted for a test.',
        outcomeType: 'BINARY',
        closeTime: FUTURE(),
        category: 'Test',
        topicSlug: 'test',
        resolutionCriteria: 'Resolves per the official source at close.',
      },
    ],
  })
}

function fetchAgainst(app: Hono): FetchLike {
  return (url, init) => app.request(url, init)
}

describe('PrediktClient against the full app', () => {
  let app: Hono
  let fetchFn: FetchLike

  beforeEach(() => {
    app = createApp({ db: openDb(':memory:'), complete })
    fetchFn = fetchAgainst(app)
  })

  async function freshClient(name = 'sdk-agent') {
    return PrediktClient.signup(BASE, name, fetchFn)
  }

  it('signs up and reads its own account', async () => {
    const { client, account, apiKey } = await freshClient()
    expect(apiKey).toMatch(/^pk_/)
    expect(account.balance).toBe(1000)
    const me = await client.me()
    expect(me.account.id).toBe(account.id)
    expect(me.positions).toEqual([])
  })

  it('runs a full BINARY lifecycle: create, quote, buy, sell, resolve, payout', async () => {
    const { client: alice } = await freshClient('alice')
    const { client: bob } = await freshClient('bob')

    const market = await alice.createMarket({
      question: 'Will BTC close above $150k on Dec 31, 2026?',
      criteria: 'Resolves YES on a CoinGecko daily close above $150,000.',
      closeTime: FUTURE(),
      subsidy: 100,
      initialProb: 0.4,
    })
    expect(market.status).toBe('OPEN')

    const quote = await bob.quote(market.id, 'YES', 50)
    const trade = await bob.buy(market.id, { side: 'YES', amount: 50 })
    expect(trade.shares).toBeCloseTo(quote.shares, 6)

    const portfolio = await bob.portfolio()
    expect(portfolio.positions[0]!.marketId).toBe(market.id)
    expect(portfolio.totals.totalInvested).toBeGreaterThan(0)

    const sell = await bob.sell(market.id, { side: 'YES', shares: trade.shares / 2 })
    expect(sell.amount).toBeGreaterThan(0)

    const resolved = await alice.resolve(market.id, 'YES')
    expect(resolved.status).toBe('RESOLVED')
    expect(resolved.outcome).toBe('YES')

    const trades = await bob.myTrades()
    expect(trades.length).toBeGreaterThanOrEqual(2)
    expect(trades[0]!.question).toContain('BTC')
  })

  it('handles MULTI markets and answer-scoped trades', async () => {
    const { client: alice } = await freshClient('alice')
    const { client: bob } = await freshClient('bob')

    const market = await alice.createMarket({
      question: 'Which team wins the final?',
      criteria: 'Resolves to the winning team per the official result.',
      closeTime: FUTURE(),
      subsidy: 90,
      outcomeType: 'MULTI',
      answers: ['Red', 'Blue', 'Green'],
    })
    expect(market.answers).toHaveLength(3)
    const blue = market.answers!.find((a) => a.text === 'Blue')!

    const trade = await bob.buy(market.id, { side: 'YES', amount: 30, answerId: blue.id })
    expect(trade.answerId).toBe(blue.id)

    const fresh = await alice.getMarket(market.id)
    const blueNow = fresh.answers!.find((a) => a.id === blue.id)!
    expect(blueNow.probability).toBeGreaterThan(1 / 3)

    const resolved = await alice.resolve(market.id, blue.id)
    expect(resolved.outcome).toBe(blue.id)
  })

  it('places and cancels limit orders', async () => {
    const { client: alice } = await freshClient('alice')
    const market = await alice.createMarket({
      question: 'Will SOL close above $500 on Dec 31, 2026?',
      criteria: 'CoinGecko daily close.',
      closeTime: FUTURE(),
      subsidy: 100,
    })
    const placed = await alice.placeOrder(market.id, {
      side: 'YES',
      limitProb: 0.3,
      amount: 20,
    })
    expect(placed.order.status).toBe('OPEN')
    const mine = await alice.myOrders('OPEN')
    expect(mine.some((o) => o.id === placed.order.id)).toBe(true)
    const book = await alice.orderBook(market.id)
    expect(book.length).toBeGreaterThanOrEqual(1)
    const cancelled = await alice.cancelOrder(placed.order.id)
    expect(cancelled.order.status).toBe('CANCELLED')
  })

  it('reads activity, stats, and the feed', async () => {
    const { client: alice, account } = await freshClient('alice')
    const { client: bob } = await freshClient('bob')
    const market = await alice.createMarket({
      question: 'Will it rain tomorrow in the demo city?',
      criteria: 'Resolves per the official weather service.',
      closeTime: FUTURE(),
      subsidy: 50,
    })
    await bob.buy(market.id, { side: 'NO', amount: 15 })

    expect((await alice.listMarkets({ status: 'OPEN' })).length).toBe(1)
    expect((await alice.marketTrades(market.id)).length).toBe(1)
    expect((await alice.feed()).length).toBeGreaterThanOrEqual(2)
    expect((await alice.leaderboard('volume')).length).toBeGreaterThanOrEqual(1)
    expect((await alice.accountStats(account.id)).accountId).toBe(account.id)
    expect((await alice.platformStats()).markets).toBe(1)
  })

  it('calls the AI tools', async () => {
    const { client } = await freshClient()
    const drafts = await client.draftMarket({ topic: 'sample topic' })
    expect(drafts[0]!.outcomeType).toBe('BINARY')
    const odds = await client.estimateOdds({ question: 'Will the sample resolve YES?' })
    expect(odds.probability).toBeCloseTo(0.6, 6)
    const suggestion = await client.suggestResolution({
      question: 'Did the sample resolve YES?',
      sources: ['Official source says yes.'],
    })
    expect(suggestion.verdict).toBe('YES')
  })

  it('maps failures to PrediktApiError with the right status', async () => {
    const { client } = await freshClient()
    // 401: a method requiring auth on a keyless client fails before sending.
    const anon = new PrediktClient({ baseUrl: BASE, fetchFn })
    await expect(anon.me()).rejects.toMatchObject({
      name: 'PrediktApiError',
      status: 401,
    })
    // 404: unknown market.
    await expect(client.getMarket('mkt_missing')).rejects.toMatchObject({
      status: 404,
    })
    // 400: invalid market input.
    await expect(
      client.createMarket({
        question: 'short',
        criteria: 'too short',
        closeTime: 0,
      })
    ).rejects.toBeInstanceOf(PrediktApiError)
    // 402: buy beyond balance.
    const market = await client.createMarket({
      question: 'A valid market question here?',
      criteria: 'Resolves per the official source.',
      closeTime: FUTURE(),
      subsidy: 50,
    })
    await expect(
      client.buy(market.id, { side: 'YES', amount: 100_000 })
    ).rejects.toMatchObject({ status: 402 })
  })
})

describe('x402 deposit round-trip', () => {
  let db: Db
  let app: Hono
  let fetchFn: FetchLike

  // Anvil test account #0 — a real key so the signature genuinely verifies.
  const account = privateKeyToAccount(
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
  )

  const config: X402Config = {
    network: 'xlayer',
    chainId: 196,
    tokenAddress: '0x1E4a5963aBFD975d8c9021ce480b42188849D41d',
    payTo: '0x000000000000000000000000000000000000dEaD',
    tokenName: 'USDT',
    tokenVersion: '1',
    facilitatorUrl: null, // verify-only launch mode
  }

  beforeEach(() => {
    db = openDb(':memory:')
    const svc = new MarketService(db)
    app = new Hono()
    app.route('/', createMarketRoutes(svc))
    app.route('/', createDepositRoutes(svc, db, { config }))
    fetchFn = fetchAgainst(app)
  })

  it('challenges, signs, and completes a deposit that credits the balance', async () => {
    const { client, account: acct } = await PrediktClient.signup(
      BASE,
      'depositor',
      fetchFn
    )
    expect(acct.balance).toBe(1000)

    // First call: no payment header -> typed 402 challenge.
    const challenge = await client.deposit(25)
    expect(challenge.kind).toBe('payment-required')
    if (challenge.kind !== 'payment-required') throw new Error('unreachable')
    expect(challenge.requirements.maxAmountRequired).toBe('25000000') // 25 * 1e6
    expect(challenge.requirements.payTo.toLowerCase()).toBe(
      config.payTo!.toLowerCase()
    )

    // Sign the authorization and retry.
    const header = await buildPaymentHeader({
      account,
      requirements: challenge.requirements,
    })
    const completed = await client.deposit(25, header)
    expect(completed.kind).toBe('completed')
    if (completed.kind !== 'completed') throw new Error('unreachable')
    expect(completed.deposit.amount).toBe(25)
    expect(completed.balance).toBe(1025)
    expect(completed.paymentResponse).toBeTruthy() // X-PAYMENT-RESPONSE header

    // Replaying the same signed authorization is rejected (nonce burned).
    await expect(client.deposit(25, header)).rejects.toMatchObject({ status: 402 })
  })

  it('rejects a deposit signed for too little', async () => {
    const { client } = await PrediktClient.signup(BASE, 'depositor', fetchFn)
    const challenge = await client.deposit(50)
    if (challenge.kind !== 'payment-required') throw new Error('unreachable')
    // Sign an authorization worth only 1 base unit.
    const header = await buildPaymentHeader({
      account,
      requirements: challenge.requirements,
      value: 1n,
    })
    await expect(client.deposit(50, header)).rejects.toMatchObject({ status: 402 })
  })
})
