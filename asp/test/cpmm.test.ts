import { describe, expect, it } from 'vitest'
import {
  calcBuy,
  calcSell,
  CpmmError,
  getProb,
  initPool,
} from '../src/engine/cpmm'

describe('initPool', () => {
  it('prices YES at the initial probability', () => {
    const pool = initPool(100, 0.3)
    expect(getProb(pool)).toBeCloseTo(0.3, 10)
  })

  it('rejects non-positive subsidy and extreme probabilities', () => {
    expect(() => initPool(0, 0.5)).toThrowError(CpmmError)
    expect(() => initPool(100, 0.005)).toThrowError(CpmmError)
    expect(() => initPool(100, 0.995)).toThrowError(CpmmError)
  })
})

describe('calcBuy', () => {
  it('moves probability toward the side bought', () => {
    const pool = initPool(100, 0.5)
    const buyYes = calcBuy(pool, 'YES', 25)
    expect(buyYes.probAfter).toBeGreaterThan(0.5)
    const buyNo = calcBuy(pool, 'NO', 25)
    expect(buyNo.probAfter).toBeLessThan(0.5)
  })

  it('preserves the invariant k', () => {
    const pool = initPool(100, 0.4)
    const { newPool } = calcBuy(pool, 'YES', 37.5)
    const k = Math.pow(newPool.yes, pool.p) * Math.pow(newPool.no, 1 - pool.p)
    expect(k).toBeCloseTo(pool.k, 6)
  })

  it('gives more than amount in shares (shares are worth ≤1 each)', () => {
    const pool = initPool(100, 0.5)
    const { shares } = calcBuy(pool, 'YES', 10)
    // At 50%, YES shares cost ~0.5 each, so 10 buys ~20ish shares.
    expect(shares).toBeGreaterThan(10)
    expect(shares).toBeLessThan(25)
  })

  it('never mutates the input pool', () => {
    const pool = initPool(100, 0.5)
    const snapshot = { ...pool }
    calcBuy(pool, 'YES', 10)
    expect(pool).toEqual(snapshot)
  })

  it('rejects non-positive amounts', () => {
    const pool = initPool(100, 0.5)
    expect(() => calcBuy(pool, 'YES', 0)).toThrowError(CpmmError)
    expect(() => calcBuy(pool, 'YES', -5)).toThrowError(CpmmError)
  })
})

describe('calcSell', () => {
  it('round-trips a buy with no fee to approximately the same amount', () => {
    const pool = initPool(1000, 0.5)
    const buy = calcBuy(pool, 'YES', 50)
    const sell = calcSell(buy.newPool, 'YES', buy.shares)
    expect(sell.amount).toBeCloseTo(50, 3)
    expect(getProb(sell.newPool)).toBeCloseTo(0.5, 5)
  })

  it('preserves the invariant k after selling', () => {
    const pool = initPool(200, 0.35)
    const buy = calcBuy(pool, 'NO', 40)
    const sell = calcSell(buy.newPool, 'NO', buy.shares / 2)
    const k = Math.pow(sell.newPool.yes, pool.p) * Math.pow(sell.newPool.no, 1 - pool.p)
    expect(k).toBeCloseTo(pool.k, 5)
  })

  it('rejects non-positive share counts', () => {
    const pool = initPool(100, 0.5)
    expect(() => calcSell(pool, 'YES', 0)).toThrowError(CpmmError)
  })
})
