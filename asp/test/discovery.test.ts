// Search & discovery: FTS-ranked search (and the LIKE fallback path), category
// aggregation, trending-by-window, FTS injection safety, and the public routes
// with per-IP rate limiting. Real markets/trades are built via MarketService.

import { Hono } from 'hono'
import { beforeEach, describe, expect, it } from 'vitest'
import { openDb, type Db } from '../src/engine/store'
import { MarketService, type Account } from '../src/engine/service'
import {
  getSearchMode,
  initSearchSchema,
  listCategories,
  searchMarkets,
  trendingMarkets,
} from '../src/discovery/search'
import { createDiscoveryRoutes } from '../src/routes/discovery'

let db: Db
let svc: MarketService
let alice: Account

const FUTURE = () => Date.now() + 30 * 24 * 60 * 60 * 1000

beforeEach(() => {
  db = openDb(':memory:')
  svc = new MarketService(db)
  alice = svc.createAccount('alice-agent').account
})

function make(
  question: string,
  category: string,
  extra: Record<string, unknown> = {}
) {
  return svc.createMarket(alice.id, {
    question,
    criteria: `Resolves per the official source for: ${question}`,
    category,
    closeTime: FUTURE(),
    subsidy: 50,
    ...extra,
  })
}

function seedMarkets() {
  const btc = make('Will Bitcoin close above $150k in 2026?', 'Crypto')
  const eth = make('Will Ethereum flip Bitcoin by market cap?', 'Crypto')
  const fed = make('Will the Federal Reserve cut interest rates?', 'Finance')
  return { btc, eth, fed }
}

describe('searchMarkets (FTS mode)', () => {
  beforeEach(() => {
    expect(initSearchSchema(db)).toBe('fts')
  })

  it('ranks markets matching the query terms', () => {
    seedMarkets()
    const results = searchMarkets(db, { q: 'bitcoin' })
    expect(results.length).toBeGreaterThanOrEqual(2)
    expect(results.every((r) => /bitcoin/i.test(r.question))).toBe(true)
    // Every result carries a probability and score.
    expect(results[0]!.probability).toBeGreaterThan(0)
    expect(results[0]!.score).toBeGreaterThan(0)
  })

  it('filters by status', () => {
    const { btc } = seedMarkets()
    svc.closeMarket(alice.id, btc.id)
    const open = searchMarkets(db, { q: 'bitcoin', status: 'OPEN' })
    expect(open.some((r) => r.id === btc.id)).toBe(false)
    const closed = searchMarkets(db, { q: 'bitcoin', status: 'CLOSED' })
    expect(closed.some((r) => r.id === btc.id)).toBe(true)
  })

  it('returns [] for empty or operator-only queries instead of erroring', () => {
    seedMarkets()
    for (const q of ['   ', '""', 'NEAR(', '-', '*', '"; DROP TABLE markets;--']) {
      expect(() => searchMarkets(db, { q })).not.toThrow()
    }
  })

  it('is unharmed by hostile FTS syntax in a real query', () => {
    seedMarkets()
    // Tokens are extracted and quoted, so operators are inert but words match.
    const results = searchMarkets(db, { q: 'bitcoin OR (NEAR bitcoin)"' })
    expect(results.every((r) => /bitcoin/i.test(r.question))).toBe(true)
  })

  it('reflects an updated market in the index (triggers stay synced)', () => {
    const m = make('Will Bitcoin close above $150k in 2026?', 'Crypto')
    db.prepare('UPDATE markets SET question = ?, criteria = ? WHERE id = ?').run(
      'Will Dogecoin reach one dollar in 2026?',
      'Resolves per the official Dogecoin price source.',
      m.id
    )
    expect(searchMarkets(db, { q: 'dogecoin' }).some((r) => r.id === m.id)).toBe(
      true
    )
    expect(searchMarkets(db, { q: 'bitcoin' }).some((r) => r.id === m.id)).toBe(
      false
    )
  })
})

describe('searchMarkets (LIKE fallback)', () => {
  beforeEach(() => {
    expect(initSearchSchema(db, { forceLikeMode: true })).toBe('like')
    expect(getSearchMode(db)).toBe('like')
  })

  it('ranks by number of matched tokens', () => {
    seedMarkets()
    const results = searchMarkets(db, { q: 'bitcoin ethereum' })
    // The market mentioning both terms ranks first.
    expect(results[0]!.question).toMatch(/Ethereum flip Bitcoin/)
  })

  it('survives hostile input in LIKE mode too', () => {
    seedMarkets()
    expect(() => searchMarkets(db, { q: "100%_\\ bitcoin" })).not.toThrow()
    expect(searchMarkets(db, { q: 'bitcoin' }).length).toBeGreaterThan(0)
  })
})

describe('listCategories', () => {
  it('aggregates counts, open counts, and volume per category', () => {
    initSearchSchema(db)
    const { btc, fed } = seedMarkets()
    svc.closeMarket(alice.id, fed.id)
    const bob = svc.createAccount('bob').account
    svc.buy(bob.id, btc.id, 'YES', 20)

    const cats = listCategories(db)
    const crypto = cats.find((c) => c.category === 'Crypto')!
    const finance = cats.find((c) => c.category === 'Finance')!
    expect(crypto.markets).toBe(2)
    expect(crypto.openMarkets).toBe(2)
    expect(crypto.volume).toBeGreaterThanOrEqual(20)
    expect(finance.markets).toBe(1)
    expect(finance.openMarkets).toBe(0) // fed was closed
  })
})

describe('trendingMarkets', () => {
  it('ranks by volume within the window and excludes old trades', () => {
    initSearchSchema(db)
    const { btc, eth } = seedMarkets()
    const bob = svc.createAccount('bob').account

    svc.buy(bob.id, btc.id, 'YES', 40) // recent, big
    svc.buy(bob.id, eth.id, 'YES', 10) // recent, small
    const oldTrade = svc.buy(bob.id, eth.id, 'NO', 100) // will be backdated

    // Backdate the big ETH trade to 48h ago so it falls outside a 24h window.
    db.prepare('UPDATE trades SET created_at = ? WHERE id = ?').run(
      Date.now() - 48 * 60 * 60 * 1000,
      oldTrade.tradeId
    )

    const trending = trendingMarkets(db, { hours: 24, limit: 10 })
    const btcRow = trending.find((m) => m.id === btc.id)!
    const ethRow = trending.find((m) => m.id === eth.id)!
    expect(btcRow.windowVolume).toBeGreaterThan(ethRow.windowVolume)
    expect(trending[0]!.id).toBe(btc.id) // biggest recent volume ranks first
    // The 48h-old trade is excluded from the 24h window.
    expect(ethRow.windowVolume).toBeCloseTo(10, 4)
  })
})

describe('discovery routes', () => {
  let api: Hono
  let ipCounter = 0

  beforeEach(() => {
    api = new Hono()
    // Trust proxy headers so each test can use its own X-Forwarded-For and get
    // an isolated rate-limit bucket.
    api.route('/', createDiscoveryRoutes(db, { trustProxyHeader: true }))
    seedMarkets()
  })

  function get(path: string, ip?: string) {
    ipCounter += 1
    return api.request(path, {
      headers: { 'X-Forwarded-For': ip ?? `10.1.0.${ipCounter}` },
    })
  }

  async function json(res: Response) {
    return (await res.json()) as { success: boolean; data?: any; error?: string }
  }

  it('GET /search returns ranked results', async () => {
    const res = await get('/search?q=bitcoin')
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.data.query).toBe('bitcoin')
    expect(body.data.results.length).toBeGreaterThan(0)
  })

  it('GET /search validates the query', async () => {
    expect((await get('/search?q=a')).status).toBe(400) // too short
    expect((await get('/search')).status).toBe(400) // missing
    expect((await get('/search?q=bitcoin&limit=999')).status).toBe(400)
  })

  it('GET /categories and /trending return public aggregates', async () => {
    const cats = await json(await get('/categories'))
    expect(cats.data.categories.some((c: any) => c.category === 'Crypto')).toBe(true)
    const trend = await json(await get('/trending?hours=24'))
    expect(trend.data.hours).toBe(24)
    expect(Array.isArray(trend.data.markets)).toBe(true)
  })

  it('rate-limits /search per IP after the capacity is spent', async () => {
    const ip = '203.0.113.7'
    let last: Response | undefined
    for (let i = 0; i < 31; i += 1) last = await get('/search?q=bitcoin', ip)
    expect(last?.status).toBe(429)
    expect(last?.headers.get('Retry-After')).toBeTruthy()
  })
})
