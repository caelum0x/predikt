/**
 * Typed viem bindings to Predikt's OWN Fixed Product Market Maker (FPMM) — the
 * Gnosis-derived constant-product AMM that gives every on-chain market INSTANT
 * liquidity, even with an empty CLOB order book.
 *
 * The Solidity lives in `predikt-contracts/fpmm` (LGPL-3.0, see its NOTICE +
 * LICENSE). It is DEPLOYED as a standalone contract and called here purely via
 * its ABI — the AMM math (`calcBuyAmount` / `calcSellAmount` / `buy` / `sell` /
 * `addFunding`) is NOT reimplemented in this file. Every read hits the live RPC;
 * every write is a REAL signed transaction (simulated first to surface reverts).
 * No mocks, no fabricated quotes.
 *
 * Pool discovery: the `FPMMDeterministicFactory` emits a
 * `FixedProductMarketMakerCreation` event carrying the pool address, its
 * `conditionIds`, and its `collateralToken`. `poolFor(conditionId)` scans those
 * events (filtered to our USDC collateral) to find the pool for a market. When
 * no factory address is configured, the AMM path is simply unavailable and the
 * caller (router / trade box) falls back to the CLOB.
 *
 * Outcome index convention (VERIFIED by the fpmm anvil e2e): the FPMM builds its
 * positionIds from indexSet `1 << i`, so outcomeIndex 0 == indexSet 1 == YES and
 * outcomeIndex 1 == indexSet 2 == NO — the SAME order as `market.ts`
 * `derivePositionIds` (which returns `[YES(indexSet 1), NO(indexSet 2)]`). So an
 * `OutcomeIndex` from `market.ts` (YES=0, NO=1) maps 1:1 onto the FPMM.
 */

import {
  getAddress,
  type Abi,
  type Address,
  type Hex,
  type WriteContractParameters,
} from 'viem'
import { conditionalTokensAbi, fpmmAbi } from './abis'
import { getOnchainAddresses, OnchainAddresses, USDC_DECIMALS } from './addresses'
import { PRIMARY_CHAIN_KEY, type ChainKey } from './chains'
import { allowance, getPublicClient } from './evmClient'
import type { ConditionId, OutcomeIndex } from './market'
import { unlock } from './wallet'

const CHAIN: ChainKey = PRIMARY_CHAIN_KEY

/** The FPMM `ONE` scaling constant (fees + math use 1e18 fixed-point). */
const ONE = 10n ** 18n

/** Resolve deployment addresses or throw a user-friendly error. */
function requireAddresses(): OnchainAddresses {
  const a = getOnchainAddresses()
  if (!a) throw new Error('On-chain markets are not available right now.')
  return a
}

/** Whether the AMM path is configured at all (factory address present). */
export function isAmmEnabled(): boolean {
  return getOnchainAddresses()?.fpmmFactory != null
}

// --------------------------------------------------------------------------- //
//                               Pool discovery                                 //
// --------------------------------------------------------------------------- //

/**
 * Cache of resolved pool addresses keyed by lowercased conditionId. `null` means
 * "looked up, none exists". A missing key means "not looked up yet". Pools are
 * immutable once created, so caching a found address is always safe; we do NOT
 * cache negatives permanently (a pool may be funded later), see `poolFor`.
 */
const poolCache = new Map<string, Address>()

/**
 * Find the FPMM pool address for a market's conditionId by scanning the
 * factory's `FixedProductMarketMakerCreation` events. Returns null when no
 * factory is configured or no matching pool has been created. Matches on both
 * the conditionId AND our USDC collateral so an unrelated pool can never be
 * mistaken for this market's.
 */
export async function poolFor(
  conditionId: ConditionId
): Promise<Address | null> {
  const addresses = getOnchainAddresses()
  const factory = addresses?.fpmmFactory
  if (!addresses || !factory) return null

  const key = conditionId.toLowerCase()
  const cached = poolCache.get(key)
  if (cached) return cached

  const client = getPublicClient(CHAIN)
  const fromBlock = getFromBlock()

  let logs
  try {
    logs = await client.getLogs({
      address: factory,
      event: {
        type: 'event',
        name: 'FixedProductMarketMakerCreation',
        inputs: [
          { name: 'creator', type: 'address', indexed: true },
          { name: 'fixedProductMarketMaker', type: 'address', indexed: false },
          { name: 'conditionalTokens', type: 'address', indexed: false },
          { name: 'collateralToken', type: 'address', indexed: false },
          { name: 'conditionIds', type: 'bytes32[]', indexed: false },
          { name: 'fee', type: 'uint256', indexed: false },
        ],
      },
      fromBlock,
      toBlock: 'latest',
    })
  } catch {
    // RPC log range too wide / provider hiccup — treat as "unknown", the caller
    // gracefully falls back to the CLOB instead of surfacing an error.
    return null
  }

  const usdc = addresses.usdc.toLowerCase()
  const wanted = key
  let found: Address | null = null
  for (const log of logs) {
    const args = log.args as {
      fixedProductMarketMaker?: Address
      collateralToken?: Address
      conditionIds?: readonly Hex[]
    }
    if (!args.fixedProductMarketMaker || !args.conditionIds) continue
    if ((args.collateralToken ?? '').toLowerCase() !== usdc) continue
    const matches = args.conditionIds.some(
      (c) => c.toLowerCase() === wanted
    )
    if (matches) {
      // Last writer wins if (implausibly) two pools exist for the same market;
      // the most recent creation is the canonical one.
      found = getAddress(args.fixedProductMarketMaker)
    }
  }

  if (found) poolCache.set(key, found)
  return found
}

/** True when a funded FPMM pool exists for this market. */
export async function exists(conditionId: ConditionId): Promise<boolean> {
  return (await poolFor(conditionId)) !== null
}

/**
 * Optional earliest block to scan factory logs from, read from
 * `NEXT_PUBLIC_ONCHAIN_FPMM_FROM_BLOCK`. Providers cap `eth_getLogs` ranges, so
 * pointing this at the factory's deploy block keeps discovery fast + reliable.
 * Defaults to `0n` (full history) when unset.
 */
function getFromBlock(): bigint {
  const raw = process.env.NEXT_PUBLIC_ONCHAIN_FPMM_FROM_BLOCK
  if (!raw) return 0n
  try {
    const n = BigInt(raw.trim())
    return n >= 0n ? n : 0n
  } catch {
    return 0n
  }
}

// --------------------------------------------------------------------------- //
//                                   Reads                                      //
// --------------------------------------------------------------------------- //

/** The pool's swap fee as an 18-dp fraction of ONE (e.g. 2e16 == 2%). */
export async function poolFee(pool: Address): Promise<bigint> {
  return getPublicClient(CHAIN).readContract({
    address: pool,
    abi: fpmmAbi,
    functionName: 'fee',
  })
}

/**
 * How many outcome tokens `investmentAmount` USDC (base units) buys of
 * `outcomeIndex` (0=YES, 1=NO), net of fees. Direct call to the deployed AMM's
 * `calcBuyAmount` — the constant-product math is the contract's, not ours.
 * Returns 0n when the pool has no liquidity / the view reverts.
 */
export async function calcBuyAmount(
  pool: Address,
  outcomeIndex: OutcomeIndex,
  investmentAmount: bigint
): Promise<bigint> {
  if (investmentAmount <= 0n) return 0n
  try {
    return await getPublicClient(CHAIN).readContract({
      address: pool,
      abi: fpmmAbi,
      functionName: 'calcBuyAmount',
      args: [investmentAmount, BigInt(outcomeIndex)],
    })
  } catch {
    return 0n
  }
}

/**
 * How many outcome tokens must be sold to receive `returnAmount` USDC (base
 * units) of `outcomeIndex`, including fees. Direct call to the deployed AMM's
 * `calcSellAmount`. Returns null when the pool can't satisfy the return (view
 * reverts, e.g. draining more than a side holds).
 */
export async function calcSellAmount(
  pool: Address,
  outcomeIndex: OutcomeIndex,
  returnAmount: bigint
): Promise<bigint | null> {
  if (returnAmount <= 0n) return null
  try {
    return await getPublicClient(CHAIN).readContract({
      address: pool,
      abi: fpmmAbi,
      functionName: 'calcSellAmount',
      args: [returnAmount, BigInt(outcomeIndex)],
    })
  } catch {
    return null
  }
}

/**
 * The pool's [YES, NO] outcome-token reserves (base units). Reads the CTF
 * balances the FPMM holds for the two derived positions. Used for the marginal
 * (spot) price read below.
 */
export async function poolReserves(
  pool: Address,
  positionIds: readonly [bigint, bigint]
): Promise<readonly [bigint, bigint]> {
  const client = getPublicClient(CHAIN)
  const { conditionalTokens } = requireAddresses()
  const [yes, no] = await Promise.all([
    client.readContract({
      address: conditionalTokens,
      abi: conditionalTokensAbi,
      functionName: 'balanceOf',
      args: [pool, positionIds[0]],
    }),
    client.readContract({
      address: conditionalTokens,
      abi: conditionalTokensAbi,
      functionName: 'balanceOf',
      args: [pool, positionIds[1]],
    }),
  ])
  return [yes, no]
}

/**
 * Marginal (spot) price per outcome in [0,1], read live from the pool's
 * reserves. For a constant-product binary pool the marginal price of an outcome
 * is the OTHER side's reserve over the total reserves — i.e. the outcome that is
 * scarcer in the pool is more expensive. Returns null when the pool is empty.
 *
 * This is the instantaneous price for an infinitesimal trade (no fee, no size
 * impact); actual execution uses `calcBuyAmount` / `calcSellAmount`.
 */
export async function marginalPrices(
  pool: Address,
  positionIds: readonly [bigint, bigint]
): Promise<readonly [number, number] | null> {
  const [yes, no] = await poolReserves(pool, positionIds)
  const total = yes + no
  if (total <= 0n) return null
  // priceYes = noReserve / (yesReserve + noReserve); priceNo = 1 - priceYes.
  const priceYes = Number((no * ONE) / total) / Number(ONE)
  const priceNo = 1 - priceYes
  return [priceYes, priceNo]
}

// --------------------------------------------------------------------------- //
//                                  Writes                                      //
// --------------------------------------------------------------------------- //

async function signer() {
  const w = await unlock()
  return {
    account: w.account,
    address: w.address,
    walletClient: w.walletClient(CHAIN),
    publicClient: getPublicClient(CHAIN),
  }
}

/**
 * Simulate then broadcast a contract write; returns the tx hash.
 *
 * The abi/args are accepted as loosely-typed here because callers pass many
 * different (function, args) shapes; `simulateContract` validates them against
 * the real ABI at runtime and its returned `request` is fed straight into
 * `writeContract`, so the exact request type is opaque to this helper.
 */
async function write(params: {
  account: import('viem').Account
  walletClient: import('viem').WalletClient
  publicClient: import('viem').PublicClient
  address: Address
  abi: readonly unknown[]
  functionName: string
  args: readonly unknown[]
}): Promise<Hex> {
  const { request } = await params.publicClient.simulateContract({
    account: params.account,
    address: params.address,
    abi: params.abi as Abi,
    functionName: params.functionName,
    args: params.args,
  })
  return params.walletClient.writeContract(
    request as WriteContractParameters
  )
}

async function ensureUsdcAllowance(
  s: Awaited<ReturnType<typeof signer>>,
  usdc: Address,
  spender: Address,
  amount: bigint
): Promise<Hex | undefined> {
  const current = await allowance(CHAIN, usdc, s.address, spender)
  if (current >= amount) return undefined
  const hash = await write({
    ...s,
    address: usdc,
    abi: (await import('./abis')).erc20Abi,
    functionName: 'approve',
    args: [spender, amount],
  })
  await getPublicClient(CHAIN).waitForTransactionReceipt({ hash })
  return hash
}

async function ensureCtfApproval(
  s: Awaited<ReturnType<typeof signer>>,
  conditionalTokens: Address,
  operator: Address
): Promise<Hex | undefined> {
  const approved = await getPublicClient(CHAIN).readContract({
    address: conditionalTokens,
    abi: conditionalTokensAbi,
    functionName: 'isApprovedForAll',
    args: [s.address, operator],
  })
  if (approved) return undefined
  const hash = await write({
    ...s,
    address: conditionalTokens,
    abi: conditionalTokensAbi,
    functionName: 'setApprovalForAll',
    args: [operator, true],
  })
  await getPublicClient(CHAIN).waitForTransactionReceipt({ hash })
  return hash
}

/** Slippage tolerance applied to on-chain min-out / max-in guards (1% default). */
const DEFAULT_SLIPPAGE_BPS = 100n

function applySlippageDown(amount: bigint, bps = DEFAULT_SLIPPAGE_BPS): bigint {
  return (amount * (10_000n - bps)) / 10_000n
}

function applySlippageUp(amount: bigint, bps = DEFAULT_SLIPPAGE_BPS): bigint {
  return (amount * (10_000n + bps)) / 10_000n
}

export interface AmmBuyResult {
  approve?: Hex
  buy: Hex
  /** The freshly-quoted outcome tokens used to set the min-out guard. */
  quotedOut: bigint
  minOut: bigint
}

/**
 * BUY `outcomeIndex` on the AMM by spending `investmentAmount` USDC (base
 * units): approve USDC -> pool if needed, re-quote `calcBuyAmount` at send time,
 * then `buy(...)` with a slippage-bounded `minOutcomeTokensToBuy`. Real tx.
 * `minOutOverride` (base units) pins the guard exactly (e.g. to a router quote).
 */
export async function buy(
  pool: Address,
  outcomeIndex: OutcomeIndex,
  investmentAmount: bigint,
  minOutOverride?: bigint
): Promise<AmmBuyResult> {
  if (investmentAmount <= 0n) throw new Error('Enter an amount to buy.')
  const addresses = requireAddresses()
  const s = await signer()

  const approve = await ensureUsdcAllowance(
    s,
    addresses.usdc,
    pool,
    investmentAmount
  )

  const quotedOut = await getPublicClient(CHAIN).readContract({
    address: pool,
    abi: fpmmAbi,
    functionName: 'calcBuyAmount',
    args: [investmentAmount, BigInt(outcomeIndex)],
  })
  if (quotedOut <= 0n) {
    throw new Error('The AMM has no liquidity to price this trade.')
  }
  const minOut =
    minOutOverride != null ? minOutOverride : applySlippageDown(quotedOut)

  const buyHash = await write({
    ...s,
    address: pool,
    abi: fpmmAbi,
    functionName: 'buy',
    args: [investmentAmount, BigInt(outcomeIndex), minOut],
  })
  return { approve, buy: buyHash, quotedOut, minOut }
}

export interface AmmSellResult {
  approve?: Hex
  sell: Hex
  /** The freshly-quoted tokens-to-sell used to set the max-in guard. */
  quotedTokensIn: bigint
  maxTokensIn: bigint
}

/**
 * SELL `outcomeIndex` on the AMM for `returnAmount` USDC (base units): approve
 * the pool as a CTF operator if needed, re-quote `calcSellAmount` at send time,
 * then `sell(...)` with a slippage-bounded `maxOutcomeTokensToSell`. Real tx.
 * `maxInOverride` pins the guard exactly (e.g. to a router quote).
 */
export async function sell(
  pool: Address,
  outcomeIndex: OutcomeIndex,
  returnAmount: bigint,
  maxInOverride?: bigint
): Promise<AmmSellResult> {
  if (returnAmount <= 0n) throw new Error('Enter an amount to sell.')
  const addresses = requireAddresses()
  const s = await signer()

  const approve = await ensureCtfApproval(
    s,
    addresses.conditionalTokens,
    pool
  )

  const quotedTokensIn = (await getPublicClient(CHAIN).readContract({
    address: pool,
    abi: fpmmAbi,
    functionName: 'calcSellAmount',
    args: [returnAmount, BigInt(outcomeIndex)],
  })) as bigint
  const maxTokensIn =
    maxInOverride != null ? maxInOverride : applySlippageUp(quotedTokensIn)

  const sellHash = await write({
    ...s,
    address: pool,
    abi: fpmmAbi,
    functionName: 'sell',
    args: [returnAmount, BigInt(outcomeIndex), maxTokensIn],
  })
  return { approve, sell: sellHash, quotedTokensIn, maxTokensIn }
}

/**
 * Add USDC liquidity to an existing pool (approve USDC -> pool, then
 * `addFunding`). `distributionHint` is only honored on the FIRST funding of a
 * pool; pass `[]` for subsequent top-ups (the contract enforces this). Real tx.
 */
export async function addFunding(
  pool: Address,
  addedFunds: bigint,
  distributionHint: readonly bigint[] = []
): Promise<{ approve?: Hex; fund: Hex }> {
  if (addedFunds <= 0n) throw new Error('Funding must be non-zero.')
  const addresses = requireAddresses()
  const s = await signer()

  const approve = await ensureUsdcAllowance(s, addresses.usdc, pool, addedFunds)

  const fundHash = await write({
    ...s,
    address: pool,
    abi: fpmmAbi,
    functionName: 'addFunding',
    args: [addedFunds, [...distributionHint]],
  })
  return { approve, fund: fundHash }
}

/** For display: format the pool fee fraction as a percentage number. */
export function feeAsPercent(fee: bigint): number {
  return Number((fee * 10_000n) / ONE) / 100
}

/** USDC decimals re-export so callers don't need two imports. */
export { USDC_DECIMALS }
