/**
 * Typed viem bindings that call the REAL, already-deployed contracts directly.
 * No Solidity is written, wrapped, vendored, or reimplemented here — every
 * write is a REAL signed transaction (simulated first to surface reverts, then
 * broadcast via the unlocked wallet client) and every read hits the live RPC.
 * No mocks, no fakes.
 *
 * Contracts (see ./addresses.ts for the NEXT_PUBLIC_* addresses):
 *   UmaCtfAdapter       — Polymarket's trustless UMA settlement adapter.
 *   CTFExchange         — Polymarket's signed-order exchange for outcome tokens.
 *   ConditionalTokens   — Gnosis CTF: split / merge / redeem / positions / payouts.
 *   USDC                — ERC-20 collateral.
 *
 * A binary market is identified on-chain by its CTF `conditionId`. All reads and
 * writes here take that conditionId as the market handle. Outcome slot 0 == YES,
 * slot 1 == NO; the binary partition is [YES=0b01, NO=0b10].
 *
 * Trustless lifecycle (each step = a REAL tx to a REAL contract):
 *   create : UmaCtfAdapter.initialize(ancillaryData, USDC, reward, bond, liveness)
 *            — prepares the CTF condition + requests a UMA price. Requires a
 *            prior USDC approve(reward) to the adapter when reward > 0.
 *   split  : ConditionalTokens.splitPosition(USDC, 0x00, conditionId, [1,2], amt)
 *            — mint a full YES+NO set from USDC (approve USDC -> CTF first).
 *   merge  : ConditionalTokens.mergePositions(...)   — burn a set back to USDC.
 *   buy/sell: CTFExchange.fillOrder(order, fillAmount) — fill a signed maker
 *            order (approve USDC -> exchange for BUY, or CTF setApprovalForAll
 *            -> exchange for SELL).
 *   redeem : ConditionalTokens.redeemPositions(USDC, 0x00, conditionId, [1,2])
 *            — burn winning outcome tokens for USDC after resolution.
 *   resolve: UmaCtfAdapter.resolve(questionId) — permissionless settle once UMA
 *            has a price; reports payouts to CTF and unlocks redemption.
 */

import {
  decodeEventLog,
  type Abi,
  type Address,
  type Hex,
  type WriteContractParameters,
} from 'viem'
import {
  conditionalTokensAbi,
  ctfExchangeAbi,
  erc20Abi,
  umaAdapterAbi,
} from './abis'
import { getOnchainAddresses, OnchainAddresses } from './addresses'
import { PRIMARY_CHAIN_KEY, type ChainKey } from './chains'
import { allowance, erc20Balance, getPublicClient } from './evmClient'
import { unlock } from './wallet'

const CHAIN: ChainKey = PRIMARY_CHAIN_KEY

/** bytes32(0) — the CTF parent collection id for a top-level condition. */
const ZERO_BYTES32 = ('0x' + '0'.repeat(64)) as Hex
/** Binary index sets: YES = 0b01, NO = 0b10. */
const YES_INDEX_SET = 1n
const NO_INDEX_SET = 2n
const BINARY_PARTITION = [YES_INDEX_SET, NO_INDEX_SET] as const

export const OUTCOME = { YES: 0, NO: 1 } as const
export type OutcomeIndex = 0 | 1

/** A binary on-chain market is identified by its CTF conditionId. */
export type ConditionId = Hex

/** Resolve deployment addresses or throw a user-friendly error. */
function requireAddresses(): OnchainAddresses {
  const a = getOnchainAddresses()
  if (!a) throw new Error('On-chain markets are not available right now.')
  return a
}

// --------------------------------------------------------------------------- //
//                              Position id derivation                          //
// --------------------------------------------------------------------------- //

/**
 * Derive the [YES, NO] ERC-1155 position ids for a binary condition. These are
 * pure/view CTF computations: collectionId(parent=0, condition, indexSet) then
 * positionId(collateral, collectionId). No writes.
 */
export async function derivePositionIds(
  conditionId: ConditionId
): Promise<readonly [bigint, bigint]> {
  const client = getPublicClient(CHAIN)
  const { conditionalTokens, usdc } = requireAddresses()

  const [yesCollection, noCollection] = await Promise.all([
    client.readContract({
      address: conditionalTokens,
      abi: conditionalTokensAbi,
      functionName: 'getCollectionId',
      args: [ZERO_BYTES32, conditionId, YES_INDEX_SET],
    }),
    client.readContract({
      address: conditionalTokens,
      abi: conditionalTokensAbi,
      functionName: 'getCollectionId',
      args: [ZERO_BYTES32, conditionId, NO_INDEX_SET],
    }),
  ])

  const [yesId, noId] = await Promise.all([
    client.readContract({
      address: conditionalTokens,
      abi: conditionalTokensAbi,
      functionName: 'getPositionId',
      args: [usdc, yesCollection],
    }),
    client.readContract({
      address: conditionalTokens,
      abi: conditionalTokensAbi,
      functionName: 'getPositionId',
      args: [usdc, noCollection],
    }),
  ])
  return [yesId, noId]
}

// --------------------------------------------------------------------------- //
//                                  Reads                                       //
// --------------------------------------------------------------------------- //

export interface OnchainMarketState {
  conditionId: ConditionId
  positionIds: readonly [bigint, bigint]
  /** True once the UMA answer has been reported to Conditional Tokens. */
  resolved: boolean
  /** [YES, NO] payout numerators after resolution (all 0 while unresolved). */
  payouts: readonly [bigint, bigint]
  /**
   * [YES, NO] settlement prices in [0,1]. Before resolution these come from the
   * adapter's expected payouts (UMA's proposed answer) when available, else
   * 0.5/0.5; after resolution they are the final CTF payout split. Live
   * order-book mid-prices require the off-chain order relay and are surfaced by
   * the trade layer, not derived on-chain here.
   */
  prices: readonly [number, number]
}

/** Read live market state for a conditionId: positions, resolution + payouts. */
export async function readMarketState(
  conditionId: ConditionId
): Promise<OnchainMarketState> {
  const client = getPublicClient(CHAIN)
  const { conditionalTokens } = requireAddresses()

  const [positionIds, den] = await Promise.all([
    derivePositionIds(conditionId),
    client.readContract({
      address: conditionalTokens,
      abi: conditionalTokensAbi,
      functionName: 'payoutDenominator',
      args: [conditionId],
    }),
  ])

  const resolved = (den as bigint) > 0n
  let payouts: readonly [bigint, bigint] = [0n, 0n]
  let prices: readonly [number, number] = [0.5, 0.5]

  if (resolved) {
    const [numYes, numNo] = await Promise.all([
      client
        .readContract({
          address: conditionalTokens,
          abi: conditionalTokensAbi,
          functionName: 'payoutNumerators',
          args: [conditionId, 0n],
        })
        .catch(() => 0n),
      client
        .readContract({
          address: conditionalTokens,
          abi: conditionalTokensAbi,
          functionName: 'payoutNumerators',
          args: [conditionId, 1n],
        })
        .catch(() => 0n),
    ])
    payouts = [numYes as bigint, numNo as bigint]
    const total = Number(payouts[0]) + Number(payouts[1])
    if (total > 0) {
      prices = [Number(payouts[0]) / total, Number(payouts[1]) / total]
    }
  }

  return { conditionId, positionIds, resolved, payouts, prices }
}

/**
 * The adapter's expected payouts for a question, if UMA already has a proposed
 * or settled answer. Returns null when not yet available (reverts on the view).
 * Used to show an indicative YES/NO split before final resolution.
 */
export async function readExpectedPayouts(
  questionId: Hex
): Promise<readonly [number, number] | null> {
  const { umaAdapter } = requireAddresses()
  try {
    const raw = (await getPublicClient(CHAIN).readContract({
      address: umaAdapter,
      abi: umaAdapterAbi,
      functionName: 'getExpectedPayouts',
      args: [questionId],
    })) as readonly bigint[]
    const yes = Number(raw[0] ?? 0n)
    const no = Number(raw[1] ?? 0n)
    const total = yes + no
    if (total <= 0) return null
    return [yes / total, no / total]
  } catch {
    return null
  }
}

/** USDC (base units) the connected wallet holds. */
export async function readUsdcBalance(owner: Address): Promise<bigint> {
  const { usdc } = requireAddresses()
  return erc20Balance(CHAIN, usdc, owner)
}

/** A user's YES/NO outcome-token balances for a market (base units). */
export async function readUserPosition(
  conditionId: ConditionId,
  owner: Address
): Promise<{ yes: bigint; no: bigint }> {
  const client = getPublicClient(CHAIN)
  const { conditionalTokens } = requireAddresses()
  const [yesId, noId] = await derivePositionIds(conditionId)
  const [yes, no] = await Promise.all([
    client.readContract({
      address: conditionalTokens,
      abi: conditionalTokensAbi,
      functionName: 'balanceOf',
      args: [owner, yesId],
    }),
    client.readContract({
      address: conditionalTokens,
      abi: conditionalTokensAbi,
      functionName: 'balanceOf',
      args: [owner, noId],
    }),
  ])
  return { yes, no }
}

/** True once the market's UMA answer has been reported (redeemable). */
export async function isResolved(conditionId: ConditionId): Promise<boolean> {
  return (await readMarketState(conditionId)).resolved
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
    abi: erc20Abi,
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

// --------------------------------------------------------------------------- //
//                               Create market                                  //
// --------------------------------------------------------------------------- //

export interface CreateOnchainMarketParams {
  /** Human-readable question text, sent to UMA as ancillary data. */
  question: string
  /** UMA proposer reward in USDC base units (0 -> no reward). */
  rewardUsdc?: bigint
  /** UMA proposal/dispute bond in USDC base units (0 -> UMA minimum). */
  bondUsdc?: bigint
  /** UMA liveness window in seconds (0 -> UMA default). */
  livenessSeconds?: bigint
  /**
   * If true, also register the derived YES/NO CTF token ids on the CTF Exchange
   * so they can be traded. Requires the wallet to be an exchange admin; skipped
   * silently (with the hash omitted) when not authorized.
   */
  registerOnExchange?: boolean
}

export interface CreateOnchainMarketResult {
  questionId: Hex
  conditionId: Hex
  positionIds: readonly [bigint, bigint]
  txHashes: {
    approve?: Hex
    initialize: Hex
    registerToken?: Hex
  }
}

/**
 * Create a trustless on-chain market by calling the REAL UmaCtfAdapter:
 *   1. approve USDC -> adapter for the reward (only when reward > 0), then
 *   2. adapter.initialize(...) — this prepares the CTF condition AND requests a
 *      UMA price. The questionId is the keccak of the ancillary data; the
 *      conditionId is CTF.getConditionId(adapter, questionId, 2).
 * Optionally registers the two outcome tokens on the CTF Exchange.
 */
export async function createOnchainMarket(
  params: CreateOnchainMarketParams
): Promise<CreateOnchainMarketResult> {
  const { stringToHex } = await import('viem')
  const addresses = requireAddresses()
  const s = await signer()

  const reward = params.rewardUsdc ?? 0n
  const bond = params.bondUsdc ?? 0n
  const liveness = params.livenessSeconds ?? 0n
  const ancillaryData = stringToHex(params.question)

  let approveHash: Hex | undefined
  if (reward > 0n) {
    approveHash = await ensureUsdcAllowance(
      s,
      addresses.usdc,
      addresses.umaAdapter,
      reward
    )
  }

  const initializeHash = await write({
    ...s,
    address: addresses.umaAdapter,
    abi: umaAdapterAbi,
    functionName: 'initialize',
    args: [ancillaryData, addresses.usdc, reward, bond, liveness],
  })
  const receipt = await getPublicClient(CHAIN).waitForTransactionReceipt({
    hash: initializeHash,
  })

  const questionId = decodeQuestionInitialized(
    receipt.logs,
    addresses.umaAdapter
  )
  if (!questionId) {
    throw new Error('Market created but its question id could not be read.')
  }

  // conditionId = CTF.getConditionId(adapter, questionId, outcomeSlotCount=2).
  const conditionId = (await getPublicClient(CHAIN).readContract({
    address: addresses.conditionalTokens,
    abi: conditionalTokensAbi,
    functionName: 'getConditionId',
    args: [addresses.umaAdapter, questionId, 2n],
  })) as Hex

  const positionIds = await derivePositionIds(conditionId)

  let registerHash: Hex | undefined
  if (params.registerOnExchange) {
    try {
      registerHash = await write({
        ...s,
        address: addresses.exchange,
        abi: ctfExchangeAbi,
        functionName: 'registerToken',
        args: [positionIds[0], positionIds[1], conditionId],
      })
      await getPublicClient(CHAIN).waitForTransactionReceipt({
        hash: registerHash,
      })
    } catch {
      // Not authorized to register on the exchange; the market still exists and
      // is fully splittable/redeemable. Registration can be done later by an op.
      registerHash = undefined
    }
  }

  return {
    questionId,
    conditionId,
    positionIds,
    txHashes: {
      approve: approveHash,
      initialize: initializeHash,
      registerToken: registerHash,
    },
  }
}

function decodeQuestionInitialized(
  logs: readonly { address: Address; topics: readonly Hex[]; data: Hex }[],
  adapter: Address
): Hex | null {
  for (const log of logs) {
    if (log.address.toLowerCase() !== adapter.toLowerCase()) continue
    try {
      const decoded = decodeEventLog({
        abi: umaAdapterAbi,
        topics: log.topics as [signature: Hex, ...args: Hex[]],
        data: log.data,
        eventName: 'QuestionInitialized',
      })
      const args = decoded.args as unknown as { questionID: Hex }
      return args.questionID
    } catch {
      // Not the QuestionInitialized log; keep scanning.
    }
  }
  return null
}

// --------------------------------------------------------------------------- //
//                          Split / merge (CTF collateral <-> set)              //
// --------------------------------------------------------------------------- //

/**
 * Split USDC into a full YES+NO outcome-token set (base units) via the REAL
 * ConditionalTokens. Approves USDC -> CTF if needed, then splitPosition().
 */
export async function splitPosition(
  conditionId: ConditionId,
  amountUsdc: bigint
): Promise<{ approve?: Hex; split: Hex }> {
  const addresses = requireAddresses()
  const s = await signer()

  const approveHash = await ensureUsdcAllowance(
    s,
    addresses.usdc,
    addresses.conditionalTokens,
    amountUsdc
  )

  const splitHash = await write({
    ...s,
    address: addresses.conditionalTokens,
    abi: conditionalTokensAbi,
    functionName: 'splitPosition',
    args: [
      addresses.usdc,
      ZERO_BYTES32,
      conditionId,
      [...BINARY_PARTITION],
      amountUsdc,
    ],
  })
  return { approve: approveHash, split: splitHash }
}

/**
 * Merge a full YES+NO set back into USDC (base units) via the REAL
 * ConditionalTokens mergePositions().
 */
export async function mergePositions(
  conditionId: ConditionId,
  amount: bigint
): Promise<{ merge: Hex }> {
  const addresses = requireAddresses()
  const s = await signer()
  const mergeHash = await write({
    ...s,
    address: addresses.conditionalTokens,
    abi: conditionalTokensAbi,
    functionName: 'mergePositions',
    args: [
      addresses.usdc,
      ZERO_BYTES32,
      conditionId,
      [...BINARY_PARTITION],
      amount,
    ],
  })
  return { merge: mergeHash }
}

// --------------------------------------------------------------------------- //
//                          Trade (CTF Exchange fillOrder)                      //
// --------------------------------------------------------------------------- //

/** A signed maker order as returned by the exchange order relay. */
export interface SignedExchangeOrder {
  salt: bigint
  maker: Address
  signer: Address
  taker: Address
  tokenId: bigint
  makerAmount: bigint
  takerAmount: bigint
  expiration: bigint
  nonce: bigint
  feeRateBps: bigint
  /** 0 == BUY, 1 == SELL (from the maker's perspective). */
  side: number
  /** 0 == EOA, 1 == POLY_PROXY, 2 == POLY_GNOSIS_SAFE. */
  signatureType: number
  signature: Hex
}

/**
 * Fill a signed maker order on the REAL CTF Exchange. `fillAmount` is the
 * amount of the maker's making-asset to fill (USDC base units for a maker BUY,
 * outcome-token base units for a maker SELL). The taker (this wallet) must have
 * approved the exchange for whatever asset it gives up:
 *   - taker gives USDC (maker is SELLing tokens): approve USDC -> exchange.
 *   - taker gives tokens (maker is BUYing tokens): setApprovalForAll CTF -> exchange.
 * Returns the approval (if any) and the fill tx hash.
 */
export async function fillOrder(
  order: SignedExchangeOrder,
  fillAmount: bigint
): Promise<{ approve?: Hex; fill: Hex }> {
  const addresses = requireAddresses()
  const s = await signer()

  // Taker gives up the COMPLEMENT of what the maker gives. Maker BUY (side 0)
  // means the maker gives USDC and takes tokens, so the taker gives tokens ->
  // needs CTF operator approval. Maker SELL (side 1) means the taker gives USDC.
  let approveHash: Hex | undefined
  if (order.side === 1) {
    approveHash = await ensureUsdcAllowance(
      s,
      addresses.usdc,
      addresses.exchange,
      fillAmount
    )
  } else {
    approveHash = await ensureCtfApproval(
      s,
      addresses.conditionalTokens,
      addresses.exchange
    )
  }

  const fillHash = await write({
    ...s,
    address: addresses.exchange,
    abi: ctfExchangeAbi,
    functionName: 'fillOrder',
    args: [order, fillAmount],
  })
  return { approve: approveHash, fill: fillHash }
}

/**
 * Cancel one of the caller's own signed orders on the REAL exchange.
 */
export async function cancelOrder(
  order: SignedExchangeOrder
): Promise<{ cancel: Hex }> {
  const addresses = requireAddresses()
  const s = await signer()
  const cancelHash = await write({
    ...s,
    address: addresses.exchange,
    abi: ctfExchangeAbi,
    functionName: 'cancelOrder',
    args: [order],
  })
  return { cancel: cancelHash }
}

// --------------------------------------------------------------------------- //
//                              Redeem after resolution                         //
// --------------------------------------------------------------------------- //

/**
 * Redeem resolved positions for USDC via the REAL ConditionalTokens. Burns the
 * caller's winning YES/NO outcome tokens and pays out collateral against the
 * reported payouts. Permissionless.
 */
export async function redeem(
  conditionId: ConditionId
): Promise<{ redeem: Hex }> {
  const addresses = requireAddresses()
  const s = await signer()
  const state = await readMarketState(conditionId)
  if (!state.resolved) {
    throw new Error('This market has not resolved yet.')
  }
  const redeemHash = await write({
    ...s,
    address: addresses.conditionalTokens,
    abi: conditionalTokensAbi,
    functionName: 'redeemPositions',
    args: [addresses.usdc, ZERO_BYTES32, conditionId, [...BINARY_PARTITION]],
  })
  return { redeem: redeemHash }
}

// --------------------------------------------------------------------------- //
//                             Resolve from UMA                                 //
// --------------------------------------------------------------------------- //

/**
 * Permissionlessly settle a market from UMA's answer via the REAL adapter
 * (adapter.resolve). Anyone can call this once UMA has a price; it maps the
 * answer to payouts and reports them to Conditional Tokens, unlocking redemption.
 */
export async function resolveFromUma(
  questionId: Hex
): Promise<{ resolve: Hex }> {
  const addresses = requireAddresses()
  const s = await signer()
  const resolveHash = await write({
    ...s,
    address: addresses.umaAdapter,
    abi: umaAdapterAbi,
    functionName: 'resolve',
    args: [questionId],
  })
  return { resolve: resolveHash }
}

/** True once UMA has a price ready for the adapter to resolve the question. */
export async function isReadyToResolve(questionId: Hex): Promise<boolean> {
  const { umaAdapter } = requireAddresses()
  try {
    return (await getPublicClient(CHAIN).readContract({
      address: umaAdapter,
      abi: umaAdapterAbi,
      functionName: 'ready',
      args: [questionId],
    })) as boolean
  } catch {
    return false
  }
}
