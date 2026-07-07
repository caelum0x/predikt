/**
 * Real behavior tests for the on-chain best-execution router.
 *
 * We test the router's REAL pure logic directly (no production module is faked):
 *   - `pickWinner`: best-execution selection (more tokens on BUY, more USDC on
 *     SELL; graceful null when neither venue prices).
 *   - `quoteClobFromBook`: CLOB depth-walking against a real RelayBook shape.
 *   - `invertSellQuote`: the monotone binary-search sell inversion, driven by a
 *     REAL constant-product sell oracle (an actual monotone AMM curve, not a
 *     stub of the router's own math).
 *   - `toBaseUnits`/`fromBaseUnits`: parsing + NaN/Infinity guards.
 */
import {
  fromBaseUnits,
  invertSellQuote,
  pickWinner,
  quoteClobFromBook,
  toBaseUnits,
  type QuoteRequest,
  type VenueQuote,
} from './router'
import type { RelayBook, RelayOrderView } from './orders'

// --------------------------------------------------------------------------- //
//                                 Fixtures                                     //
// --------------------------------------------------------------------------- //

function ask(price: number, shares: number): RelayOrderView {
  return {
    hash: '0x00',
    maker: '0x0000000000000000000000000000000000000001',
    tokenId: '1',
    side: 'SELL',
    makerAmount: '0',
    takerAmount: '0',
    // remainingMaker for an ask = share base units (6dp).
    remainingMaker: BigInt(Math.round(shares * 1e6)).toString(),
    // priceWad = price * 1e18.
    priceWad: BigInt(Math.round(price * 1e18)).toString(),
    status: 'OPEN',
    createdAt: 0,
    updatedAt: 0,
  }
}

function bid(price: number, usdc: number): RelayOrderView {
  return {
    hash: '0x00',
    maker: '0x0000000000000000000000000000000000000001',
    tokenId: '1',
    side: 'BUY',
    makerAmount: '0',
    takerAmount: '0',
    // remainingMaker for a bid = USDC base units (6dp).
    remainingMaker: BigInt(Math.round(usdc * 1e6)).toString(),
    priceWad: BigInt(Math.round(price * 1e18)).toString(),
    status: 'OPEN',
    createdAt: 0,
    updatedAt: 0,
  }
}

function book(bids: RelayOrderView[], asks: RelayOrderView[]): RelayBook {
  return { tokenId: '1', bids, asks }
}

function quote(partial: Partial<VenueQuote>): VenueQuote {
  return {
    venue: 'AMM',
    usdc: 0n,
    outcomeTokens: 0n,
    avgPrice: 0,
    complete: true,
    ...partial,
  }
}

// --------------------------------------------------------------------------- //
//                              pickWinner (routing)                            //
// --------------------------------------------------------------------------- //

describe('pickWinner: best execution', () => {
  it('BUY picks the venue returning MORE outcome tokens', () => {
    const amm = quote({ venue: 'AMM', usdc: 100n, outcomeTokens: 180n })
    const clob = quote({ venue: 'CLOB', usdc: 100n, outcomeTokens: 200n })
    expect(pickWinner('BUY', amm, clob)?.venue).toBe('CLOB')
    // And when the AMM gives more, it wins.
    const ammBetter = quote({ venue: 'AMM', usdc: 100n, outcomeTokens: 220n })
    expect(pickWinner('BUY', ammBetter, clob)?.venue).toBe('AMM')
  })

  it('SELL picks the venue paying MORE USDC', () => {
    const amm = quote({ venue: 'AMM', usdc: 90n, outcomeTokens: 100n })
    const clob = quote({ venue: 'CLOB', usdc: 95n, outcomeTokens: 100n })
    expect(pickWinner('SELL', amm, clob)?.venue).toBe('CLOB')
    const ammBetter = quote({ venue: 'AMM', usdc: 96n, outcomeTokens: 100n })
    expect(pickWinner('SELL', ammBetter, clob)?.venue).toBe('AMM')
  })

  it('a single available venue wins by default', () => {
    const amm = quote({ venue: 'AMM', outcomeTokens: 10n, usdc: 5n })
    const clob = quote({ venue: 'CLOB', outcomeTokens: 10n, usdc: 5n })
    expect(pickWinner('BUY', amm, null)).toBe(amm)
    expect(pickWinner('BUY', null, clob)).toBe(clob)
    expect(pickWinner('SELL', amm, null)).toBe(amm)
    expect(pickWinner('SELL', null, clob)).toBe(clob)
  })

  it('returns null when NEITHER venue can price (graceful "none")', () => {
    expect(pickWinner('BUY', null, null)).toBeNull()
    expect(pickWinner('SELL', null, null)).toBeNull()
  })

  it('ties break to the AMM (deterministic, single-tx)', () => {
    const amm = quote({ venue: 'AMM', usdc: 100n, outcomeTokens: 200n })
    const clob = quote({ venue: 'CLOB', usdc: 100n, outcomeTokens: 200n })
    expect(pickWinner('BUY', amm, clob)?.venue).toBe('AMM')
    const ammS = quote({ venue: 'AMM', usdc: 90n, outcomeTokens: 100n })
    const clobS = quote({ venue: 'CLOB', usdc: 90n, outcomeTokens: 100n })
    expect(pickWinner('SELL', ammS, clobS)?.venue).toBe('AMM')
  })
})

// --------------------------------------------------------------------------- //
//                        quoteClobFromBook (CLOB depth)                        //
// --------------------------------------------------------------------------- //

describe('quoteClobFromBook: BUY sweeps asks cheapest-first', () => {
  const req = (amount: number): QuoteRequest => ({
    conditionId: '0x00',
    outcome: 'YES',
    side: 'BUY',
    amount,
  })

  it('returns null for a null book', () => {
    expect(quoteClobFromBook(req(10), null)).toBeNull()
  })

  it('returns null for a zero/negative/NaN amount', () => {
    const b = book([], [ask(0.5, 100)])
    expect(quoteClobFromBook(req(0), b)).toBeNull()
    expect(quoteClobFromBook(req(-5), b)).toBeNull()
    expect(quoteClobFromBook(req(NaN), b)).toBeNull()
  })

  it('buys the cheapest level fully when affordable', () => {
    // 100 shares @ $0.40 = $40 spend for 100 tokens.
    const b = book([], [ask(0.4, 100)])
    const q = quoteClobFromBook(req(40), b)
    expect(q).not.toBeNull()
    expect(q!.venue).toBe('CLOB')
    expect(q!.outcomeTokens).toBe(100_000_000n) // 100 shares, 6dp
    expect(q!.usdc).toBe(40_000_000n)
    expect(q!.avgPrice).toBeCloseTo(0.4)
    expect(q!.complete).toBe(true)
  })

  it('walks multiple levels cheapest-first and reports partial fills', () => {
    // $0.40 (50 sh = $20) then $0.60 (100 sh). Spend $50 -> all 50 @ .4 ($20)
    // then $30 of the .6 level buys 50 shares ($30). Total 100 sh, $50 spent.
    const b = book([], [ask(0.6, 100), ask(0.4, 50)])
    const q = quoteClobFromBook(req(50), b)!
    expect(q.outcomeTokens).toBe(100_000_000n)
    expect(q.usdc).toBe(50_000_000n)
    expect(q.complete).toBe(true)
  })

  it('reports incomplete when the book is too thin', () => {
    const b = book([], [ask(0.4, 10)]) // only $4 of depth
    const q = quoteClobFromBook(req(100), b)!
    expect(q.outcomeTokens).toBe(10_000_000n)
    expect(q.usdc).toBe(4_000_000n)
    expect(q.complete).toBe(false)
  })

  it('ignores out-of-range price levels (price<=0 or >1)', () => {
    const b = book([], [ask(0, 100), ask(1.5, 100), ask(0.5, 20)])
    const q = quoteClobFromBook(req(100), b)!
    // Only the $0.50 x 20-share level is valid: $10 for 20 tokens.
    expect(q.outcomeTokens).toBe(20_000_000n)
    expect(q.usdc).toBe(10_000_000n)
  })
})

describe('quoteClobFromBook: SELL sweeps bids highest-first', () => {
  const req = (amount: number): QuoteRequest => ({
    conditionId: '0x00',
    outcome: 'YES',
    side: 'SELL',
    amount,
  })

  it('sells into the best bid first', () => {
    // Bid $0.70 with a $70 budget absorbs 100 shares. Selling 100 -> $70.
    const b = book([bid(0.7, 70)], [])
    const q = quoteClobFromBook(req(100), b)!
    expect(q.venue).toBe('CLOB')
    expect(q.usdc).toBe(70_000_000n)
    expect(q.outcomeTokens).toBe(100_000_000n) // shares sold
    expect(q.avgPrice).toBeCloseTo(0.7)
    expect(q.complete).toBe(true)
  })

  it('returns null when there are no bids', () => {
    expect(quoteClobFromBook(req(100), book([], []))).toBeNull()
  })

  it('reports incomplete when bids cannot absorb the full size', () => {
    // One $0.50 bid with only $10 budget absorbs 20 shares of a 100 sell.
    const b = book([bid(0.5, 10)], [])
    const q = quoteClobFromBook(req(100), b)!
    expect(q.outcomeTokens).toBe(20_000_000n)
    expect(q.usdc).toBe(10_000_000n)
    expect(q.complete).toBe(false)
  })
})

// --------------------------------------------------------------------------- //
//               invertSellQuote (monotone binary-search inversion)            //
// --------------------------------------------------------------------------- //

/**
 * A REAL, monotone constant-product sell oracle: to receive `R` USDC (base
 * units) you must sell `tokens = R * a / (b - R)` outcome tokens, where the pool
 * holds `a`/`b` on the two sides. This is the genuine convex AMM sell curve —
 * strictly increasing in R and undefined (null) once R drains the paying side.
 */
function makeCpmmSell(a: bigint, b: bigint) {
  return async (returnUsdc: bigint): Promise<bigint | null> => {
    if (returnUsdc <= 0n) return 0n
    if (returnUsdc >= b) return null // pool can't pay this much
    return (returnUsdc * a) / (b - returnUsdc)
  }
}

describe('invertSellQuote: sell inversion', () => {
  it('finds the largest USDC return whose token cost ≤ sellShares', async () => {
    const a = 1_000_000_000n
    const b = 1_000_000_000n
    const calcSell = makeCpmmSell(a, b)
    const sellShares = 100_000_000n // 100 tokens
    const usdcOut = await invertSellQuote(calcSell, sellShares)
    expect(usdcOut).not.toBeNull()
    // The result must be FEASIBLE: its token cost is ≤ what we're selling.
    const cost = await calcSell(usdcOut!)
    expect(cost).not.toBeNull()
    expect(cost! <= sellShares).toBe(true)
    // And MAXIMAL: one more base unit of USDC would need more tokens than we have.
    const costPlus = await calcSell(usdcOut! + 1n)
    expect(costPlus === null || costPlus > sellShares).toBe(true)
  })

  it('is monotone: selling more shares yields >= USDC', async () => {
    const calcSell = makeCpmmSell(2_000_000_000n, 2_000_000_000n)
    const small = await invertSellQuote(calcSell, 10_000_000n)
    const large = await invertSellQuote(calcSell, 500_000_000n)
    expect(small).not.toBeNull()
    expect(large).not.toBeNull()
    expect(large! >= small!).toBe(true)
  })

  it('returns null / 0 for a zero or negative sell size', async () => {
    const calcSell = makeCpmmSell(1_000_000_000n, 1_000_000_000n)
    expect(await invertSellQuote(calcSell, 0n)).toBeNull()
    expect(await invertSellQuote(calcSell, -5n)).toBeNull()
  })

  it('handles a pool that can never price (always null) gracefully', async () => {
    const never = async () => null
    expect(await invertSellQuote(never, 100_000_000n)).toBeNull()
  })

  it('proceeds never exceed the shares sold (each token < $1)', async () => {
    const calcSell = makeCpmmSell(5_000_000_000n, 5_000_000_000n)
    const sellShares = 250_000_000n
    const usdcOut = await invertSellQuote(calcSell, sellShares)
    expect(usdcOut).not.toBeNull()
    expect(usdcOut! <= sellShares).toBe(true)
  })
})

// --------------------------------------------------------------------------- //
//                        toBaseUnits / fromBaseUnits guards                    //
// --------------------------------------------------------------------------- //

describe('toBaseUnits / fromBaseUnits', () => {
  it('converts human decimals to 6dp base units', () => {
    expect(toBaseUnits(1)).toBe(1_000_000n)
    expect(toBaseUnits(0.5)).toBe(500_000n)
    expect(toBaseUnits(1234.56)).toBe(1_234_560_000n)
  })

  it('guards NaN / Infinity / non-positive inputs to 0n (no throw)', () => {
    expect(toBaseUnits(NaN)).toBe(0n)
    expect(toBaseUnits(Infinity)).toBe(0n)
    expect(toBaseUnits(-Infinity)).toBe(0n)
    expect(toBaseUnits(0)).toBe(0n)
    expect(toBaseUnits(-1)).toBe(0n)
  })

  it('round-trips through fromBaseUnits', () => {
    expect(fromBaseUnits(1_000_000n)).toBe(1)
    expect(fromBaseUnits(1_234_560_000n)).toBeCloseTo(1234.56)
    expect(fromBaseUnits(0n)).toBe(0)
  })

  it('handles a huge (but finite) amount without throwing', () => {
    const big = toBaseUnits(1e12)
    expect(big).toBe(1_000_000_000_000_000_000n)
    expect(Number.isFinite(fromBaseUnits(big))).toBe(true)
  })
})
