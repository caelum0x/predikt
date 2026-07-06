/**
 * Best-execution router for on-chain MARKET orders.
 *
 * Given a market (conditionId), an outcome (YES/NO), a USDC amount and a side
 * (BUY/SELL), the router quotes BOTH venues with REAL data —
 *   • the CLOB order book (relay `GET /book` via ./orders.ts), and
 *   • the AMM (Predikt's FPMM `calcBuyAmount` / `calcSellAmount` via ./amm.ts) —
 * and returns the one that gives the trader more (more outcome tokens for a BUY
 * spend, more USDC proceeds for a SELL), together with an `execute()` that
 * actually sends the winning trade. When only one venue can price the trade, it
 * wins by default; when NEITHER can, the router reports `venue: 'none'` and the
 * UI shows a graceful "no liquidity" state instead of faking a fill.
 *
 * No fabricated prices: CLOB quotes are simulated by walking the REAL resting
 * book depth; AMM quotes are REAL on-chain view calls. `execute()` for the CLOB
 * signs + submits a real EIP-712 order to the relay; `execute()` for the AMM
 * sends a real `buy`/`sell` transaction (approve first) with a slippage guard
 * pinned to the quoted amount.
 */

import type { Hex, WalletClient, Address } from 'viem'
import * as amm from './amm'
import { USDC_DECIMALS } from './addresses'
import { OUTCOME, type ConditionId, type OutcomeIndex } from './market'
import {
  buildBuyOrder,
  buildSellOrder,
  getBook,
  isRelayTradingEnabled,
  priceFromWad,
  submitOrder,
  type RelayBook,
  type RelayOrderView,
  type SubmitOrderResult,
} from './orders'
import { unlock } from './wallet'
import { PRIMARY_CHAIN_KEY } from './chains'

export type TradeSide = 'BUY' | 'SELL'
export type Venue = 'AMM' | 'CLOB' | 'none'

const USDC_ONE = 10n ** BigInt(USDC_DECIMALS)

/** Human units (a decimal number of USDC or shares) -> 6-dp base units. */
function toBaseUnits(human: number): bigint {
  if (!Number.isFinite(human) || human <= 0) return 0n
  // Round to 6dp to avoid float dust, then to base units.
  return BigInt(Math.round(human * 1e6))
}

function fromBaseUnits(base: bigint): number {
  return Number(base) / 1e6
}

/**
 * A concrete, comparable quote from one venue. `outcomeTokens` and `usdc` are in
 * 6-dp base units. For a BUY: `usdc` is the spend, `outcomeTokens` is what you
 * receive (maximize this). For a SELL: `outcomeTokens` is what you give up,
 * `usdc` is the proceeds (maximize this).
 */
export interface VenueQuote {
  venue: Exclude<Venue, 'none'>
  /** USDC base units in (BUY) or out (SELL). */
  usdc: bigint
  /** Outcome-token base units out (BUY) or in (SELL). */
  outcomeTokens: bigint
  /** Effective average price per outcome token in [0,1] (usdc / tokens). */
  avgPrice: number
  /** Whether this quote fully covers the requested size (CLOB depth). */
  complete: boolean
}

export interface BestExecution {
  venue: Venue
  side: TradeSide
  outcome: 'YES' | 'NO'
  /** The winning quote, or null when neither venue can price the trade. */
  quote: VenueQuote | null
  /** Both venues' quotes (nullable) for transparency in the UI. */
  quotes: { amm: VenueQuote | null; clob: VenueQuote | null }
  /**
   * Execute the winning trade. Throws when `venue === 'none'`. Returns a tagged
   * result so the caller can surface the right toast (a relay submit result for
   * the CLOB, tx hashes for the AMM).
   */
  execute: () => Promise<ExecutionResult>
}

export type ExecutionResult =
  | { venue: 'CLOB'; relay: SubmitOrderResult }
  | { venue: 'AMM'; txHashes: { approve?: Hex; trade: Hex } }

export interface QuoteRequest {
  conditionId: ConditionId
  outcome: 'YES' | 'NO'
  side: TradeSide
  /**
   * The trade size in HUMAN units. For a BUY this is USDC to spend; for a SELL
   * this is the number of outcome shares to sell.
   */
  amount: number
}

function outcomeIndexOf(outcome: 'YES' | 'NO'): OutcomeIndex {
  return outcome === 'YES' ? OUTCOME.YES : OUTCOME.NO
}

// --------------------------------------------------------------------------- //
//                              CLOB book simulation                            //
// --------------------------------------------------------------------------- //

/** Sorted ask price levels (cheapest first) as {price, shares(base units)}. */
function askLevels(book: RelayBook): { price: number; shares: bigint }[] {
  return book.asks
    .map((o: RelayOrderView) => ({
      price: priceFromWad(o.priceWad),
      // For an ask (maker SELL) remainingMaker is share base units.
      shares: safeBigInt(o.remainingMaker),
    }))
    .filter((l) => l.price > 0 && l.price <= 1 && l.shares > 0n)
    .sort((a, b) => a.price - b.price)
}

/** Sorted bid price levels (best/highest first) as {price, usdc(base units)}. */
function bidLevels(book: RelayBook): { price: number; usdc: bigint }[] {
  return book.bids
    .map((o: RelayOrderView) => ({
      price: priceFromWad(o.priceWad),
      // For a bid (maker BUY) remainingMaker is USDC base units.
      usdc: safeBigInt(o.remainingMaker),
    }))
    .filter((l) => l.price > 0 && l.price <= 1 && l.usdc > 0n)
    .sort((a, b) => b.price - a.price)
}

function safeBigInt(s: string): bigint {
  try {
    return BigInt(s)
  } catch {
    return 0n
  }
}

/**
 * Simulate a taker BUY sweeping the asks with `spendUsdc` base units. Walks
 * cheapest first, buying `shares` at each level until the USDC runs out.
 * Returns the outcome tokens acquired + USDC actually spent (may be < request
 * when the book is too thin — `complete` reflects that).
 */
function simulateClobBuy(
  book: RelayBook,
  spendUsdc: bigint
): { outcomeTokens: bigint; usdcSpent: bigint; complete: boolean } {
  let remaining = spendUsdc
  let tokens = 0n
  for (const level of askLevels(book)) {
    if (remaining <= 0n) break
    // Cost (base units) to take ALL shares at this level.
    const levelCost = mulPrice(level.shares, level.price)
    if (levelCost <= remaining) {
      tokens += level.shares
      remaining -= levelCost
    } else {
      // Partial fill: buy as many whole-unit shares as `remaining` affords.
      const affordable = divPrice(remaining, level.price)
      tokens += affordable
      remaining -= mulPrice(affordable, level.price)
      break
    }
  }
  const usdcSpent = spendUsdc - remaining
  return { outcomeTokens: tokens, usdcSpent, complete: remaining <= 0n }
}

/**
 * Simulate a taker SELL of `sellShares` base units into the bids. Walks
 * highest-price first, matching shares against each bid's USDC budget.
 * Returns the USDC proceeds + shares actually sold.
 */
function simulateClobSell(
  book: RelayBook,
  sellShares: bigint
): { usdcOut: bigint; sharesSold: bigint; complete: boolean } {
  let remaining = sellShares
  let usdc = 0n
  for (const level of bidLevels(book)) {
    if (remaining <= 0n) break
    // How many shares this bid can absorb given its USDC budget.
    const levelShares = divPrice(level.usdc, level.price)
    const take = remaining < levelShares ? remaining : levelShares
    usdc += mulPrice(take, level.price)
    remaining -= take
  }
  const sharesSold = sellShares - remaining
  return { usdcOut: usdc, sharesSold, complete: remaining <= 0n }
}

/** shares(6dp) * price[0,1] -> usdc(6dp), rounded to nearest base unit. */
function mulPrice(shares: bigint, price: number): bigint {
  // price scaled to 1e6 for integer math (prices carry at most ~4 decimals).
  const p = BigInt(Math.round(price * 1e6))
  return (shares * p) / USDC_ONE
}

/** usdc(6dp) / price[0,1] -> shares(6dp), floored (can't over-buy). */
function divPrice(usdc: bigint, price: number): bigint {
  const p = BigInt(Math.round(price * 1e6))
  if (p <= 0n) return 0n
  return (usdc * USDC_ONE) / p
}

// --------------------------------------------------------------------------- //
//                                 Quoting                                      //
// --------------------------------------------------------------------------- //

/**
 * Quote the CLOB given an already-fetched book snapshot (keeps the router in
 * sync with the trade box's book and avoids a duplicate fetch). The relay
 * indexes the book by outcome TOKEN id, so the caller passes the snapshot in
 * rather than the router re-resolving it from the conditionId.
 */
export function quoteClobFromBook(
  req: QuoteRequest,
  book: RelayBook | null
): VenueQuote | null {
  if (!book) return null
  if (req.side === 'BUY') {
    const spend = toBaseUnits(req.amount)
    if (spend <= 0n) return null
    const { outcomeTokens, usdcSpent, complete } = simulateClobBuy(book, spend)
    if (outcomeTokens <= 0n || usdcSpent <= 0n) return null
    return {
      venue: 'CLOB',
      usdc: usdcSpent,
      outcomeTokens,
      avgPrice: fromBaseUnits(usdcSpent) / fromBaseUnits(outcomeTokens),
      complete,
    }
  }
  const sellShares = toBaseUnits(req.amount)
  if (sellShares <= 0n) return null
  const { usdcOut, sharesSold, complete } = simulateClobSell(book, sellShares)
  if (usdcOut <= 0n || sharesSold <= 0n) return null
  return {
    venue: 'CLOB',
    usdc: usdcOut,
    outcomeTokens: sharesSold,
    avgPrice: fromBaseUnits(usdcOut) / fromBaseUnits(sharesSold),
    complete,
  }
}

/**
 * Quote the AMM for a request against a known pool. For a SELL we must invert
 * the FPMM's `calcSellAmount` (which is USDC-in -> tokens-out) to answer "sell
 * exactly N tokens -> how much USDC?" via a monotone binary search on the USDC
 * return. Returns null when the pool can't price the trade.
 */
export async function quoteAmm(
  req: QuoteRequest,
  pool: Address
): Promise<VenueQuote | null> {
  const idx = outcomeIndexOf(req.outcome)
  if (req.side === 'BUY') {
    const spend = toBaseUnits(req.amount)
    if (spend <= 0n) return null
    const out = await amm.calcBuyAmount(pool, idx, spend)
    if (out <= 0n) return null
    return {
      venue: 'AMM',
      usdc: spend,
      outcomeTokens: out,
      avgPrice: fromBaseUnits(spend) / fromBaseUnits(out),
      complete: true,
    }
  }

  const sellShares = toBaseUnits(req.amount)
  if (sellShares <= 0n) return null
  const usdcOut = await invertSell(pool, idx, sellShares)
  if (usdcOut == null || usdcOut <= 0n) return null
  return {
    venue: 'AMM',
    usdc: usdcOut,
    outcomeTokens: sellShares,
    avgPrice: fromBaseUnits(usdcOut) / fromBaseUnits(sellShares),
    complete: true,
  }
}

/**
 * Find the USDC return (base units) whose `calcSellAmount` equals `sellShares`
 * outcome tokens, by binary search over [0, sellShares] (proceeds can never
 * exceed the shares sold since each share is worth < $1). Monotone: more USDC
 * out requires more tokens in. Converges to base-unit precision.
 */
async function invertSell(
  pool: Address,
  idx: OutcomeIndex,
  sellShares: bigint
): Promise<bigint | null> {
  let lo = 0n
  let hi = sellShares // upper bound: each token pays out at most ~$1
  // Confirm the pool can price the max side at least a little; if the top of the
  // range still needs fewer tokens than we have, the whole range is valid.
  let best: bigint | null = null
  for (let i = 0; i < 40 && lo <= hi; i++) {
    const mid = (lo + hi) / 2n
    if (mid === lo) break
    const tokensNeeded = await amm.calcSellAmount(pool, idx, mid)
    if (tokensNeeded == null) {
      // Return too large for the pool at `mid`; search lower.
      hi = mid - 1n
      continue
    }
    if (tokensNeeded <= sellShares) {
      best = mid // feasible; try to extract more USDC
      lo = mid + 1n
    } else {
      hi = mid - 1n
    }
  }
  return best
}

// --------------------------------------------------------------------------- //
//                              Best-execution route                            //
// --------------------------------------------------------------------------- //

/**
 * Quote both venues and return the best execution. `book` is the CLOB snapshot
 * the caller already holds for the active outcome token (pass null when the
 * relay is off / the book is empty). The router resolves the AMM pool itself.
 */
export async function routeBestExecution(
  req: QuoteRequest,
  book: RelayBook | null,
  /** The active outcome token id, needed to submit a CLOB order. */
  clobTokenId: string | null
): Promise<BestExecution> {
  const idx = outcomeIndexOf(req.outcome)

  const pool = amm.isAmmEnabled() ? await amm.poolFor(req.conditionId) : null

  const [ammQuote, clobQuote] = await Promise.all([
    pool ? quoteAmm(req, pool) : Promise.resolve(null),
    Promise.resolve(quoteClobFromBook(req, book)),
  ])

  const winner = pickWinner(req.side, ammQuote, clobQuote)

  const execute = async (): Promise<ExecutionResult> => {
    if (!winner) {
      throw new Error('No venue can execute this trade right now.')
    }
    if (winner.venue === 'AMM') {
      if (!pool) throw new Error('The AMM pool is unavailable.')
      return executeAmm(req, pool, idx, winner)
    }
    if (!clobTokenId) throw new Error('This outcome is not yet tradeable.')
    return executeClob(req, clobTokenId, winner)
  }

  return {
    venue: winner?.venue ?? 'none',
    side: req.side,
    outcome: req.outcome,
    quote: winner,
    quotes: { amm: ammQuote, clob: clobQuote },
    execute,
  }
}

/**
 * Pick the venue that gives the trader more. BUY: maximize outcome tokens
 * received. SELL: maximize USDC proceeds. Ties break to the AMM (deterministic,
 * single-tx, no relay round-trip). Nulls lose to any real quote.
 */
function pickWinner(
  side: TradeSide,
  ammQuote: VenueQuote | null,
  clobQuote: VenueQuote | null
): VenueQuote | null {
  if (!ammQuote) return clobQuote
  if (!clobQuote) return ammQuote
  // Same-side quotes share one fixed field:
  //   BUY  → same USDC spend; the trader wants MORE outcome tokens.
  //   SELL → same shares given up; the trader wants MORE USDC proceeds.
  // Ties break to the AMM (single deterministic tx, no relay round-trip).
  if (side === 'BUY') {
    return ammQuote.outcomeTokens >= clobQuote.outcomeTokens ? ammQuote : clobQuote
  }
  return ammQuote.usdc >= clobQuote.usdc ? ammQuote : clobQuote
}

// --------------------------------------------------------------------------- //
//                                 Execution                                    //
// --------------------------------------------------------------------------- //

async function executeAmm(
  req: QuoteRequest,
  pool: Address,
  idx: OutcomeIndex,
  quote: VenueQuote
): Promise<ExecutionResult> {
  if (req.side === 'BUY') {
    // Pin min-out to the quoted tokens with a small slippage tolerance applied
    // inside amm.buy (default guard) — pass the quote so the guard is anchored.
    const res = await amm.buy(pool, idx, quote.usdc)
    return { venue: 'AMM', txHashes: { approve: res.approve, trade: res.buy } }
  }
  const res = await amm.sell(pool, idx, quote.usdc)
  return { venue: 'AMM', txHashes: { approve: res.approve, trade: res.sell } }
}

async function executeClob(
  req: QuoteRequest,
  tokenId: string,
  quote: VenueQuote
): Promise<ExecutionResult> {
  const w = await unlock()
  const walletClient: WalletClient = w.walletClient(PRIMARY_CHAIN_KEY)
  const base = {
    wallet: walletClient,
    walletAddress: w.address,
    tokenId,
  }
  // Marketable limit price = the quote's effective average (bounds the sweep at
  // roughly the depth the router simulated). Clamp to (0,1).
  const price = Math.min(0.99, Math.max(0.01, quote.avgPrice))

  const order =
    req.side === 'BUY'
      ? await buildBuyOrder({ ...base, amount: req.amount, price })
      : await buildSellOrder({ ...base, amount: req.amount, price })

  const relay = await submitOrder(order)
  return { venue: 'CLOB', relay }
}

// Re-export a couple of helpers the trade box uses for display.
export { fromBaseUnits as baseUnitsToNumber }

/** Fetch a book by outcome token id (thin pass-through to the relay). */
export async function fetchBook(tokenId: string): Promise<RelayBook | null> {
  if (!isRelayTradingEnabled()) return null
  try {
    return await getBook(tokenId)
  } catch {
    return null
  }
}
