/**
 * Real behavior tests for the AMM (FPMM) client's PURE helpers. The on-chain
 * read/write paths hit a live RPC and are not exercised here; the extracted
 * pure math (marginal price, slippage guards, fee formatting, from-block env
 * parsing) is tested for real, including degenerate-pool + NaN/Infinity guards.
 */
import {
  applySlippageDown,
  applySlippageUp,
  feeAsPercent,
  getFromBlock,
  isAmmEnabled,
  marginalPricesFromReserves,
} from './amm'

const ONE = 10n ** 18n

describe('marginalPricesFromReserves: CPMM spot price', () => {
  it('is 0.5 / 0.5 for a balanced pool', () => {
    const p = marginalPricesFromReserves(1_000n, 1_000n)!
    expect(p[0]).toBeCloseTo(0.5)
    expect(p[1]).toBeCloseTo(0.5)
  })

  it('the scarcer side is dearer (price is the OTHER reserve / total)', () => {
    // YES scarce (100) vs NO plentiful (300): priceYes = 300/400 = 0.75.
    const p = marginalPricesFromReserves(100n, 300n)!
    expect(p[0]).toBeCloseTo(0.75)
    expect(p[1]).toBeCloseTo(0.25)
  })

  it('prices always sum to 1 and lie in [0,1]', () => {
    const cases: [bigint, bigint][] = [
      [1n, 1_000_000n],
      [1_000_000n, 1n],
      [7n, 13n],
      [ONE, 3n * ONE],
    ]
    for (const [y, n] of cases) {
      const p = marginalPricesFromReserves(y, n)!
      expect(p[0]).toBeGreaterThanOrEqual(0)
      expect(p[0]).toBeLessThanOrEqual(1)
      expect(p[1]).toBeGreaterThanOrEqual(0)
      expect(p[1]).toBeLessThanOrEqual(1)
      expect(p[0] + p[1]).toBeCloseTo(1)
      expect(Number.isNaN(p[0])).toBe(false)
      expect(Number.isNaN(p[1])).toBe(false)
    }
  })

  it('returns null for a degenerate empty pool (guards divide-by-zero)', () => {
    expect(marginalPricesFromReserves(0n, 0n)).toBeNull()
  })

  it('returns null when reserves sum to <= 0 (no NaN/Infinity leak)', () => {
    // Defensive: negative reserves can never happen on-chain but must not throw.
    expect(marginalPricesFromReserves(-5n, 5n)).toBeNull()
  })

  it('handles huge reserves without overflow/NaN', () => {
    const huge = 10n ** 30n
    const p = marginalPricesFromReserves(huge, huge)!
    expect(p[0]).toBeCloseTo(0.5)
    expect(Number.isFinite(p[0])).toBe(true)
  })
})

describe('slippage guards', () => {
  it('applySlippageDown lowers the amount by the bps (min-out)', () => {
    // 1% default: 1_000_000 -> 990_000.
    expect(applySlippageDown(1_000_000n)).toBe(990_000n)
    expect(applySlippageDown(1_000_000n, 250n)).toBe(975_000n)
  })

  it('applySlippageUp raises the amount by the bps (max-in)', () => {
    expect(applySlippageUp(1_000_000n)).toBe(1_010_000n)
    expect(applySlippageUp(1_000_000n, 250n)).toBe(1_025_000n)
  })

  it('down-guard is always <= up-guard and both >= 0', () => {
    const amt = 123_456_789n
    expect(applySlippageDown(amt) <= amt).toBe(true)
    expect(applySlippageUp(amt) >= amt).toBe(true)
    expect(applySlippageDown(0n)).toBe(0n)
    expect(applySlippageUp(0n)).toBe(0n)
  })
})

describe('feeAsPercent', () => {
  it('formats an 18-dp fee fraction as a percentage number', () => {
    expect(feeAsPercent(2n * 10n ** 16n)).toBeCloseTo(2) // 2e16 == 2%
    expect(feeAsPercent(0n)).toBe(0)
    expect(feeAsPercent(10n ** 16n)).toBeCloseTo(1) // 1%
  })
})

describe('getFromBlock: env parsing', () => {
  const KEY = 'NEXT_PUBLIC_ONCHAIN_FPMM_FROM_BLOCK'
  const original = process.env[KEY]
  afterEach(() => {
    if (original === undefined) delete process.env[KEY]
    else process.env[KEY] = original
  })

  it('defaults to 0n when unset', () => {
    delete process.env[KEY]
    expect(getFromBlock()).toBe(0n)
  })

  it('parses a valid decimal block number', () => {
    process.env[KEY] = '  12345678  '
    expect(getFromBlock()).toBe(12345678n)
  })

  it('clamps negative to 0n', () => {
    process.env[KEY] = '-5'
    expect(getFromBlock()).toBe(0n)
  })

  it('falls back to 0n on garbage (no throw)', () => {
    process.env[KEY] = 'not-a-number'
    expect(getFromBlock()).toBe(0n)
  })
})

describe('isAmmEnabled', () => {
  it('is false when no FPMM factory is configured (off-chain default intact)', () => {
    // No NEXT_PUBLIC_ONCHAIN_* addresses are set in the test env, so the whole
    // on-chain path — including the AMM — is unavailable.
    expect(isAmmEnabled()).toBe(false)
  })
})
