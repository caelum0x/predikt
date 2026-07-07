/**
 * Real behavior tests for the pure, network-free surface of the on-chain market
 * bindings (market.ts).
 *
 * Everything that touches the chain (reads/writes) is intentionally NOT stubbed
 * with a fake RPC here — that would be a mock, and this suite is REAL-only.
 * Instead we exercise the genuinely pure logic that runs BEFORE any RPC call:
 *
 *   1. The exported OUTCOME slot mapping (YES=0, NO=1) — the invariant every
 *      caller relies on to index the binary partition.
 *   2. The `requireAddresses()` guard reached synchronously at the top of every
 *      public entrypoint: when the deployment is not configured (no
 *      NEXT_PUBLIC_ONCHAIN_* env vars), each function must reject with the
 *      user-friendly "not available right now" message rather than attempting a
 *      network call. This is the branch that keeps the play-money default fully
 *      intact when on-chain is disabled.
 *
 * The jest environment has NO NEXT_PUBLIC_ONCHAIN_* vars set (verified in the
 * runner), so getOnchainAddresses() returns null and the guard fires for real.
 */

import {
  OUTCOME,
  cancelOrder,
  createOnchainMarket,
  derivePositionIds,
  fillOrder,
  isReadyToResolve,
  isResolved,
  mergePositions,
  readExpectedPayouts,
  readMarketState,
  readUsdcBalance,
  readUserPosition,
  redeem,
  resolveFromUma,
  splitPosition,
  type ConditionId,
  type SignedExchangeOrder,
} from './market'
import { getOnchainAddresses } from './addresses'
import type { Address, Hex } from 'viem'

const NOT_AVAILABLE = 'On-chain markets are not available right now.'
const CONDITION_ID = ('0x' + 'ab'.repeat(32)) as ConditionId
const QUESTION_ID = ('0x' + 'cd'.repeat(32)) as Hex
const OWNER = '0x1111111111111111111111111111111111111111' as Address

function fakeSignedOrder(side: number): SignedExchangeOrder {
  return {
    salt: 1n,
    maker: OWNER,
    signer: OWNER,
    taker: '0x0000000000000000000000000000000000000000' as Address,
    tokenId: 42n,
    makerAmount: 1_000_000n,
    takerAmount: 1_000_000n,
    expiration: 0n,
    nonce: 0n,
    feeRateBps: 0n,
    side,
    signatureType: 0,
    signature: '0x' as Hex,
  }
}

describe('OUTCOME slot mapping (binary partition invariant)', () => {
  it('maps YES to slot 0 and NO to slot 1', () => {
    expect(OUTCOME.YES).toBe(0)
    expect(OUTCOME.NO).toBe(1)
  })

  it('is a two-slot binary mapping with distinct indices', () => {
    expect(OUTCOME.YES).not.toBe(OUTCOME.NO)
    expect(Object.values(OUTCOME).sort()).toEqual([0, 1])
  })
})

describe('deployment guard: on-chain disabled in this environment', () => {
  it('getOnchainAddresses returns null when no env is configured', () => {
    // Precondition for every guard assertion below.
    expect(getOnchainAddresses()).toBeNull()
  })

  // Read-path entrypoints: each hits requireAddresses() before any RPC.
  it('derivePositionIds rejects with the friendly message', async () => {
    await expect(derivePositionIds(CONDITION_ID)).rejects.toThrow(NOT_AVAILABLE)
  })

  it('readMarketState rejects with the friendly message', async () => {
    await expect(readMarketState(CONDITION_ID)).rejects.toThrow(NOT_AVAILABLE)
  })

  it('readExpectedPayouts rejects with the friendly message', async () => {
    await expect(readExpectedPayouts(QUESTION_ID)).rejects.toThrow(NOT_AVAILABLE)
  })

  it('readUsdcBalance rejects with the friendly message', async () => {
    await expect(readUsdcBalance(OWNER)).rejects.toThrow(NOT_AVAILABLE)
  })

  it('readUserPosition rejects with the friendly message', async () => {
    await expect(readUserPosition(CONDITION_ID, OWNER)).rejects.toThrow(
      NOT_AVAILABLE
    )
  })

  it('isResolved rejects with the friendly message', async () => {
    await expect(isResolved(CONDITION_ID)).rejects.toThrow(NOT_AVAILABLE)
  })

  it('isReadyToResolve rejects with the friendly message', async () => {
    await expect(isReadyToResolve(QUESTION_ID)).rejects.toThrow(NOT_AVAILABLE)
  })

  // Write-path entrypoints: same guard, before any wallet/simulate/broadcast.
  it('createOnchainMarket rejects with the friendly message', async () => {
    await expect(
      createOnchainMarket({ question: 'Will it rain tomorrow?' })
    ).rejects.toThrow(NOT_AVAILABLE)
  })

  it('splitPosition rejects with the friendly message', async () => {
    await expect(splitPosition(CONDITION_ID, 1_000_000n)).rejects.toThrow(
      NOT_AVAILABLE
    )
  })

  it('mergePositions rejects with the friendly message', async () => {
    await expect(mergePositions(CONDITION_ID, 1_000_000n)).rejects.toThrow(
      NOT_AVAILABLE
    )
  })

  it('fillOrder rejects with the friendly message (BUY side)', async () => {
    await expect(fillOrder(fakeSignedOrder(0), 1_000_000n)).rejects.toThrow(
      NOT_AVAILABLE
    )
  })

  it('fillOrder rejects with the friendly message (SELL side)', async () => {
    await expect(fillOrder(fakeSignedOrder(1), 1_000_000n)).rejects.toThrow(
      NOT_AVAILABLE
    )
  })

  it('cancelOrder rejects with the friendly message', async () => {
    await expect(cancelOrder(fakeSignedOrder(0))).rejects.toThrow(NOT_AVAILABLE)
  })

  it('redeem rejects with the friendly message', async () => {
    await expect(redeem(CONDITION_ID)).rejects.toThrow(NOT_AVAILABLE)
  })

  it('resolveFromUma rejects with the friendly message', async () => {
    await expect(resolveFromUma(QUESTION_ID)).rejects.toThrow(NOT_AVAILABLE)
  })
})
