// Typed TypeScript client for the Predikt Oracle ASP.
//
// One file an agent developer copies or imports to drive the whole service
// without hand-writing HTTP calls. Every call returns the unwrapped `data`
// payload of the server's {success, data, error} envelope; any failure —
// an error envelope, a malformed response, or a transport error — throws
// PrediktApiError carrying the HTTP status (0 for network failures) and the
// server's error message.
//
// Depends only on zod (response-boundary validation) and a fetch-compatible
// transport. Inject `fetchFn` to run against an in-process Hono app in tests.

import { z } from 'zod'

// ---- transport ---------------------------------------------------------------

/** fetch-compatible transport. In tests: (url, init) => app.request(path(url), init). */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

const defaultFetch: FetchLike = (input, init) => fetch(input, init)

/**
 * Every SDK failure surfaces as this error: `status` is the HTTP status of
 * the failed response (0 when the request never reached the server) and
 * `message` is the server's error string when one was provided.
 */
export class PrediktApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'PrediktApiError'
    this.status = status
  }
}

// ---- core domain types (hand-written mirrors of the API responses) -----------

export type Side = 'YES' | 'NO'
export type MarketStatus = 'OPEN' | 'CLOSED' | 'RESOLVED'
export type OutcomeType = 'BINARY' | 'MULTI'
export type OrderStatus = 'OPEN' | 'FILLED' | 'CANCELLED'
export type HexAddress = `0x${string}`

export interface Account {
  id: string
  name: string
  balance: number
  createdAt: number
}

/** One answer of a MULTI market with its own pool probability. */
export interface AnswerView {
  id: string
  text: string
  probability: number
  volume: number
}

export interface Market {
  id: string
  creatorId: string
  question: string
  description: string
  criteria: string
  category: string
  closeTime: number
  status: MarketStatus
  outcomeType: OutcomeType
  /** YES | NO | CANCEL for BINARY; winning answer id or CANCEL for MULTI. */
  outcome: string | null
  /** For MULTI markets: probability of the current leading answer. */
  probability: number
  subsidy: number
  volume: number
  createdAt: number
  resolvedAt: number | null
  /** Present only on MULTI markets. */
  answers?: AnswerView[]
}

/** Raw position as returned by GET /accounts/me. */
export interface Position {
  accountId: string
  marketId: string
  /** null for binary-market positions; the answer id for MULTI positions. */
  answerId: string | null
  yesShares: number
  noShares: number
  invested: number
}

export interface Quote {
  shares: number
  probBefore: number
  probAfter: number
  fee: number
}

/** Receipt returned by buy() and sell(), including the post-trade balance. */
export interface TradeResult {
  tradeId: string
  kind: 'BUY' | 'SELL'
  side: Side
  answerId: string | null
  amount: number
  shares: number
  fee: number
  probBefore: number
  probAfter: number
  createdAt: number
  balance: number
}

/** One trade in a market's public history (GET /markets/:id/trades). */
export interface MarketTrade {
  tradeId: string
  kind: 'BUY' | 'SELL'
  side: Side
  /** Present only on MULTI-market trades. */
  answerId?: string
  amount: number
  shares: number
  fee: number
  probBefore: number
  probAfter: number
  createdAt: number
  accountId: string
}

/** One trade in the caller's own history (GET /accounts/me/trades). */
export interface AccountTrade extends MarketTrade {
  marketId: string
  question: string
}

/** One mark-to-market position row of GET /accounts/me/portfolio. */
export interface PortfolioPosition {
  marketId: string
  question: string
  status: MarketStatus
  outcome: string | null
  probability: number
  /** MULTI positions identify their answer and its own probability. */
  answerId?: string
  answerText?: string | null
  answerProbability?: number | null
  yesShares: number
  noShares: number
  invested: number
  markValue: number
  unrealizedPnl: number
}

export interface PortfolioTotals {
  balance: number
  portfolioValue: number
  totalInvested: number
  totalUnrealizedPnl: number
}

export interface Portfolio {
  positions: PortfolioPosition[]
  totals: PortfolioTotals
}

export interface LimitOrder {
  id: string
  marketId: string
  answerId: string | null
  accountId: string
  side: Side
  limitProb: number
  amountTotal: number
  amountRemaining: number
  status: OrderStatus
  createdAt: number
  updatedAt: number
}

/** One anonymized price level of the public order book. */
export interface OrderLevel {
  side: Side
  answerId: string | null
  limitProb: number
  amount: number
}

/** placeOrder()/cancelOrder() result: the order plus the caller's balance. */
export interface OrderResult {
  order: LimitOrder
  balance: number
}

export type FeedEvent =
  | {
      type: 'trade'
      marketId: string
      question: string
      side: Side
      kind: 'BUY' | 'SELL'
      amount: number
      probAfter: number
      createdAt: number
    }
  | {
      type: 'market_created'
      marketId: string
      question: string
      probability: number
      createdAt: number
    }
  | {
      type: 'resolved'
      marketId: string
      question: string
      outcome: string
      createdAt: number
    }

export interface AccountStats {
  accountId: string
  name: string
  marketsTraded: number
  marketsResolvedTraded: number
  volume: number
  realizedProfit: number
  brierScore: number | null
  marketsCreated: number
  feesEarned: number
}

export type LeaderboardSort = 'profit' | 'brier' | 'volume'

export interface LeaderboardEntry extends AccountStats {
  rank: number
}

export interface PlatformStats {
  accounts: number
  markets: number
  openMarkets: number
  resolvedMarkets: number
  totalVolume: number
  totalTrades: number
}

// ---- request inputs -----------------------------------------------------------

export interface CreateMarketInput {
  question: string
  criteria: string
  description?: string
  category?: string
  /** Epoch milliseconds; must be in the future. */
  closeTime: number
  /** BINARY only; 0.02-0.98. */
  initialProb?: number
  /** Liquidity subsidy in credits (min 10); debited from the creator. */
  subsidy?: number
  outcomeType?: OutcomeType
  /** Required for MULTI markets: 2-12 distinct answer texts. */
  answers?: string[]
}

export interface BuyInput {
  side: Side
  /** Credits to spend (fee included). */
  amount: number
  /** Required on MULTI markets. */
  answerId?: string
}

export interface SellInput {
  side: Side
  /** Shares to sell back to the pool. */
  shares: number
  /** Required on MULTI markets. */
  answerId?: string
}

export interface PlaceOrderInput {
  side: Side
  /** 0.01-0.99: YES fills at or below, NO fills at or above. */
  limitProb: number
  /** Credits reserved for the order (1-1,000,000). */
  amount: number
  /** Required on MULTI markets. */
  answerId?: string
}

export interface HistoryOptions {
  /** Max rows (1-200, default 50). */
  limit?: number
  /** Cursor: only trades strictly before this epoch-ms timestamp. */
  before?: number
}

export interface ListMarketsOptions {
  status?: MarketStatus
}

export interface FeedOptions {
  /** Max events (1-100, default 30). */
  limit?: number
}

// ---- AI tool types --------------------------------------------------------------

export type AiOutcomeType =
  | 'BINARY'
  | 'MULTIPLE_CHOICE'
  | 'PSEUDO_NUMERIC'
  | 'MULTI_NUMERIC'
  | 'DATE'

/** At least one of topic, newsText, or url is required. */
export interface DraftMarketRequest {
  topic?: string
  newsText?: string
  url?: string
  count?: number
}

export interface DraftMarket {
  question: string
  description: string
  outcomeType: AiOutcomeType
  answers?: string[]
  closeTime: number
  category: string
  topicSlug: string
  resolutionCriteria: string
  min?: number
  max?: number
  unit?: string
  dateMin?: string
  dateMax?: string
}

export interface EstimateOddsRequest {
  question: string
  resolutionCriteria?: string
  /** ISO calendar date (YYYY-MM-DD). */
  deadline?: string
  context?: string[]
}

export type OddsConfidence = 'low' | 'medium' | 'high'

export interface OddsEstimate {
  probability: number
  confidence: OddsConfidence
  rationale: string
  baseRate: string
  keyDrivers: string[]
  updateTriggers: string[]
  citations: string[]
}

export interface SuggestResolutionRequest {
  question: string
  description?: string
  outcomeType?: AiOutcomeType
  answers?: string[]
  resolutionCriteria?: string
  sources?: string[]
}

export type ResolutionVerdict = 'YES' | 'NO' | 'ANSWER' | 'UNCLEAR'

export interface ResolutionSuggestion {
  verdict: ResolutionVerdict
  answer?: string
  confidence: number
  rationale: string
  citations: string[]
}

// ---- x402 deposit types -----------------------------------------------------------

/** One "accepts" entry of an x402 HTTP 402 challenge (scheme "exact"). */
export interface PaymentRequirements {
  scheme: 'exact'
  network: string
  /** Required payment in token base units (USDT: 6 decimals), as a string. */
  maxAmountRequired: string
  resource: string
  description: string
  mimeType: string
  payTo: HexAddress
  maxTimeoutSeconds: number
  asset: HexAddress
  /** EIP-712 domain of the token contract. */
  extra: { name: string; version: string }
}

export interface DepositRecord {
  id: string
  accountId: string
  amount: number
  txNonce: string
  network: string
  createdAt: number
}

export type DepositResult =
  | {
      /** No/invalid X-PAYMENT header: pay per `requirements`, then retry. */
      kind: 'payment-required'
      x402Version: number
      requirements: PaymentRequirements
      accepts: PaymentRequirements[]
    }
  | {
      kind: 'completed'
      deposit: DepositRecord
      balance: number
      /** Base64 X-PAYMENT-RESPONSE settlement header, when present. */
      paymentResponse: string | null
    }

// ---- response-boundary schemas ----------------------------------------------------

const envelopeSchema = z.object({
  success: z.boolean(),
  data: z.unknown().optional(),
  error: z.string().optional(),
})

const hexAddressSchema = z.custom<HexAddress>(
  (v) => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v),
  'Expected a 0x-prefixed 20-byte hex address.'
)

const paymentRequirementsSchema = z
  .object({
    scheme: z.literal('exact'),
    network: z.string().min(1),
    maxAmountRequired: z.string().regex(/^\d+$/),
    resource: z.string(),
    description: z.string(),
    mimeType: z.string(),
    payTo: hexAddressSchema,
    maxTimeoutSeconds: z.number().positive(),
    asset: hexAddressSchema,
    extra: z.object({ name: z.string(), version: z.string() }),
  })
  .passthrough()

const paymentChallengeSchema = z
  .object({
    x402Version: z.number(),
    error: z.string(),
    accepts: z.array(paymentRequirementsSchema).min(1),
  })
  .passthrough()

// ---- the client ---------------------------------------------------------------------

export interface PrediktClientOptions {
  /** Service base URL, e.g. "https://predikt-oracle.fly.dev". */
  baseUrl: string
  /** Bearer API key (pk_...); required for authenticated methods. */
  apiKey?: string
  /** Transport override; defaults to global fetch. */
  fetchFn?: FetchLike
}

export interface SignupResult {
  client: PrediktClient
  account: Account
  /** Shown exactly once — store it securely. */
  apiKey: string
}

type QueryValue = string | number | undefined

type SendOptions = {
  body?: unknown
  query?: Record<string, QueryValue>
  headers?: Record<string, string>
  auth?: boolean
}

export class PrediktClient {
  readonly baseUrl: string
  private readonly apiKey: string | null
  private readonly fetchFn: FetchLike

  constructor(options: PrediktClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.apiKey = options.apiKey?.trim() || null
    this.fetchFn = options.fetchFn ?? defaultFetch
  }

  /** Create an account and get back a ready-to-use authenticated client. */
  static async signup(
    baseUrl: string,
    name: string,
    fetchFn?: FetchLike
  ): Promise<SignupResult> {
    const anonymous = new PrediktClient({ baseUrl, fetchFn })
    const data = await anonymous.call<{ account: Account; apiKey: string }>(
      'POST',
      '/accounts',
      { body: { name } }
    )
    return {
      client: new PrediktClient({ baseUrl, apiKey: data.apiKey, fetchFn }),
      account: data.account,
      apiKey: data.apiKey,
    }
  }

  // ---- accounts -----------------------------------------------------------

  /** The caller's account plus raw open positions. */
  me(): Promise<{ account: Account; positions: Position[] }> {
    return this.call('GET', '/accounts/me', { auth: true })
  }

  /** Open positions marked to market, plus account-level totals. */
  portfolio(): Promise<Portfolio> {
    return this.call('GET', '/accounts/me/portfolio', { auth: true })
  }

  /** The caller's own trade history, newest first. */
  async myTrades(opts: HistoryOptions = {}): Promise<AccountTrade[]> {
    const data = await this.call<{ trades: AccountTrade[] }>(
      'GET',
      '/accounts/me/trades',
      { auth: true, query: { limit: opts.limit, before: opts.before } }
    )
    return data.trades
  }

  // ---- markets --------------------------------------------------------------

  async listMarkets(opts: ListMarketsOptions = {}): Promise<Market[]> {
    const data = await this.call<{ markets: Market[] }>('GET', '/markets', {
      query: { status: opts.status },
    })
    return data.markets
  }

  async getMarket(id: string): Promise<Market> {
    const data = await this.call<{ market: Market }>(
      'GET',
      `/markets/${encodeURIComponent(id)}`
    )
    return data.market
  }

  /** Price a hypothetical buy without executing it. MULTI needs answerId. */
  async quote(
    id: string,
    side: Side,
    amount: number,
    answerId?: string
  ): Promise<Quote> {
    const data = await this.call<{ quote: Quote }>(
      'GET',
      `/markets/${encodeURIComponent(id)}/quote`,
      { query: { side, amount, answerId } }
    )
    return data.quote
  }

  /** Create a BINARY or MULTI market (subsidy is debited from the caller). */
  async createMarket(input: CreateMarketInput): Promise<Market> {
    const data = await this.call<{ market: Market }>('POST', '/markets', {
      auth: true,
      body: input,
    })
    return data.market
  }

  async buy(id: string, input: BuyInput): Promise<TradeResult> {
    const data = await this.call<{ trade: TradeResult }>(
      'POST',
      `/markets/${encodeURIComponent(id)}/buy`,
      { auth: true, body: input }
    )
    return data.trade
  }

  async sell(id: string, input: SellInput): Promise<TradeResult> {
    const data = await this.call<{ trade: TradeResult }>(
      'POST',
      `/markets/${encodeURIComponent(id)}/sell`,
      { auth: true, body: input }
    )
    return data.trade
  }

  /** Creator only: close a market to further trading. */
  async closeMarket(id: string): Promise<Market> {
    const data = await this.call<{ market: Market }>(
      'POST',
      `/markets/${encodeURIComponent(id)}/close`,
      { auth: true }
    )
    return data.market
  }

  /**
   * Creator only. BINARY: outcome is YES | NO | CANCEL. MULTI: the winning
   * answerId or CANCEL.
   */
  async resolve(id: string, outcome: string): Promise<Market> {
    const data = await this.call<{ market: Market }>(
      'POST',
      `/markets/${encodeURIComponent(id)}/resolve`,
      { auth: true, body: { outcome } }
    )
    return data.market
  }

  // ---- limit orders ------------------------------------------------------------

  /** Place a limit order; the full amount is reserved immediately. */
  placeOrder(id: string, input: PlaceOrderInput): Promise<OrderResult> {
    return this.call('POST', `/markets/${encodeURIComponent(id)}/orders`, {
      auth: true,
      body: input,
    })
  }

  /** The caller's own orders, optionally filtered by status. */
  async myOrders(status?: OrderStatus): Promise<LimitOrder[]> {
    const data = await this.call<{ orders: LimitOrder[] }>(
      'GET',
      '/accounts/me/orders',
      { auth: true, query: { status } }
    )
    return data.orders
  }

  /** Cancel an OPEN order; refunds the unfilled reservation. */
  cancelOrder(orderId: string): Promise<OrderResult> {
    return this.call('DELETE', `/orders/${encodeURIComponent(orderId)}`, {
      auth: true,
    })
  }

  /** Public anonymized order book for a market. */
  async orderBook(marketId: string): Promise<OrderLevel[]> {
    const data = await this.call<{ orders: OrderLevel[] }>(
      'GET',
      `/markets/${encodeURIComponent(marketId)}/orders`
    )
    return data.orders
  }

  // ---- activity ------------------------------------------------------------------

  /** Public trade history for one market, newest first. */
  async marketTrades(
    id: string,
    opts: HistoryOptions = {}
  ): Promise<MarketTrade[]> {
    const data = await this.call<{ trades: MarketTrade[] }>(
      'GET',
      `/markets/${encodeURIComponent(id)}/trades`,
      { query: { limit: opts.limit, before: opts.before } }
    )
    return data.trades
  }

  /** Public global activity stream, newest first. */
  async feed(opts: FeedOptions = {}): Promise<FeedEvent[]> {
    const data = await this.call<{ events: FeedEvent[] }>('GET', '/feed', {
      query: { limit: opts.limit },
    })
    return data.events
  }

  // ---- stats --------------------------------------------------------------------

  async leaderboard(
    by: LeaderboardSort = 'profit',
    limit?: number
  ): Promise<LeaderboardEntry[]> {
    const data = await this.call<{
      by: LeaderboardSort
      leaderboard: LeaderboardEntry[]
    }>('GET', '/stats/leaderboard', { query: { by, limit } })
    return data.leaderboard
  }

  async accountStats(id: string): Promise<AccountStats> {
    const data = await this.call<{ stats: AccountStats }>(
      'GET',
      `/stats/accounts/${encodeURIComponent(id)}`
    )
    return data.stats
  }

  async platformStats(): Promise<PlatformStats> {
    const data = await this.call<{ platform: PlatformStats }>(
      'GET',
      '/stats/platform'
    )
    return data.platform
  }

  // ---- AI tools -------------------------------------------------------------------

  /** Draft well-specified markets from a topic, news text, or URL. */
  async draftMarket(input: DraftMarketRequest): Promise<DraftMarket[]> {
    const data = await this.call<{ drafts: DraftMarket[] }>(
      'POST',
      '/tools/draft-market',
      { body: input }
    )
    return data.drafts
  }

  /** Calibrated probability estimate for a forecastable question. */
  async estimateOdds(input: EstimateOddsRequest): Promise<OddsEstimate> {
    const data = await this.call<{ estimate: OddsEstimate }>(
      'POST',
      '/tools/estimate-odds',
      { body: input }
    )
    return data.estimate
  }

  /** Proposed resolution verdict for a question given evidence. */
  async suggestResolution(
    input: SuggestResolutionRequest
  ): Promise<ResolutionSuggestion> {
    const data = await this.call<{ suggestion: ResolutionSuggestion }>(
      'POST',
      '/tools/suggest-resolution',
      { body: input }
    )
    return data.suggestion
  }

  // ---- deposits (x402) ---------------------------------------------------------------

  /**
   * Deposit USDT for credits via the x402 payment protocol.
   *
   * Without `paymentHeader` the server answers HTTP 402 and this resolves to
   * `{ kind: 'payment-required', requirements }` — sign the requirements
   * (see buildPaymentHeader in x402-signer.ts) and call again with the
   * header. With a valid header it resolves to the completed deposit.
   */
  async deposit(amount: number, paymentHeader?: string): Promise<DepositResult> {
    const res = await this.send('POST', '/deposits', {
      auth: true,
      body: { amount },
      headers: paymentHeader ? { 'X-PAYMENT': paymentHeader } : {},
    })

    if (res.status === 402) {
      let body: unknown
      try {
        body = await res.json()
      } catch {
        throw new PrediktApiError(402, 'Payment required (non-JSON challenge).')
      }
      const challenge = paymentChallengeSchema.safeParse(body)
      if (challenge.success) {
        const requirements = challenge.data.accepts[0]
        if (!requirements) {
          throw new PrediktApiError(402, 'Challenge listed no payment options.')
        }
        return {
          kind: 'payment-required',
          x402Version: challenge.data.x402Version,
          requirements,
          accepts: challenge.data.accepts,
        }
      }
      // Not a challenge: a rejected payment in the standard error envelope.
      const envelope = envelopeSchema.safeParse(body)
      throw new PrediktApiError(
        402,
        envelope.success && envelope.data.error
          ? envelope.data.error
          : 'Payment required.'
      )
    }

    const data = await this.unwrap<{ deposit: DepositRecord; balance: number }>(
      res
    )
    return {
      kind: 'completed',
      deposit: data.deposit,
      balance: data.balance,
      paymentResponse: res.headers.get('X-PAYMENT-RESPONSE'),
    }
  }

  // ---- internals -----------------------------------------------------------------------

  private async call<T>(
    method: string,
    path: string,
    opts: SendOptions = {}
  ): Promise<T> {
    return this.unwrap<T>(await this.send(method, path, opts))
  }

  private async send(
    method: string,
    path: string,
    opts: SendOptions
  ): Promise<Response> {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) }
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
    if (opts.auth) headers['Authorization'] = `Bearer ${this.requireKey()}`

    const init: RequestInit = { method, headers }
    if (opts.body !== undefined) init.body = JSON.stringify(opts.body)

    try {
      return await this.fetchFn(this.buildUrl(path, opts.query), init)
    } catch (err) {
      throw new PrediktApiError(
        0,
        `Network request failed: ${
          err instanceof Error ? err.message : 'unknown error'
        }`
      )
    }
  }

  private async unwrap<T>(res: Response): Promise<T> {
    let body: unknown
    try {
      body = await res.json()
    } catch {
      throw new PrediktApiError(
        res.status,
        `Server returned a non-JSON response (HTTP ${res.status}).`
      )
    }
    const parsed = envelopeSchema.safeParse(body)
    if (!parsed.success) {
      throw new PrediktApiError(
        res.status,
        `Server returned an unexpected response shape (HTTP ${res.status}).`
      )
    }
    if (!parsed.data.success) {
      throw new PrediktApiError(
        res.status,
        parsed.data.error ?? `Request failed with HTTP ${res.status}.`
      )
    }
    return parsed.data.data as T
  }

  private buildUrl(path: string, query?: Record<string, QueryValue>): string {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) params.set(key, String(value))
    }
    const qs = params.toString()
    return `${this.baseUrl}${path}${qs ? `?${qs}` : ''}`
  }

  private requireKey(): string {
    if (!this.apiKey) {
      throw new PrediktApiError(
        401,
        'This method requires an API key. Construct the client with { apiKey } or use PrediktClient.signup().'
      )
    }
    return this.apiKey
  }
}
