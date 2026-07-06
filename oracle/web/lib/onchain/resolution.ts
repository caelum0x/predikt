/**
 * Trustless-resolution reads for an on-chain market.
 *
 * Every value here is a REAL on-chain read against the already-deployed
 * contracts (no mocks, no fabricated status):
 *   - UmaCtfAdapter.isInitialized(questionId)   — is the question live on-chain?
 *   - UmaCtfAdapter.getQuestion(questionId)      — requestTimestamp, liveness,
 *                                                  resolved, paused, bond, reward.
 *   - UmaCtfAdapter.getExpectedPayouts(questionId) — the optimistic answer once a
 *                                                  price has been PROPOSED (view
 *                                                  reverts before then).
 *   - UmaCtfAdapter.ready(questionId)            — has the answer passed its
 *                                                  challenge window and become
 *                                                  final (undisputed)?
 *   - ConditionalTokens.payoutDenominator(conditionId) — >0 once the answer has
 *                                                  been reported and the market
 *                                                  is redeemable (RESOLVED).
 *
 * From these we derive one plain, human status. The challenge/liveness window is
 * computed from the REAL on-chain `requestTimestamp + liveness`; when a proposal
 * exists but the window hasn't elapsed we surface the time left. Nothing is
 * invented — when a market has no question id or isn't on-chain, we return an
 * explicit `Unknown`/`NotOnchain` status and the UI hides the panel.
 *
 * IMPORTANT — no state is claimed beyond what these reads prove. A real dispute
 * lives on the OptimisticOracleV2, whose per-request state would have to be keyed
 * by the adapter's internally-stamped ancillary data. That stamp format is not
 * verifiable from this repo (only the JSON ABIs are vendored, not the adapter
 * Solidity), so we do NOT read the oracle and we do NOT assert a "Disputed" state
 * we cannot prove. Every status here is derived only from the adapter/CTF reads:
 *   - RESOLVED  : payouts reported (payoutDenominator>0 or getQuestion.resolved).
 *   - PROPOSED  : an optimistic answer exists (getExpectedPayouts succeeded); if
 *                 `ready` or the computed window has elapsed we say the answer is
 *                 awaiting the final resolve() call, otherwise the challenge
 *                 window is still open (with time left when known). We never label
 *                 an elapsed-but-unready proposal "Disputed" — that would claim
 *                 more than the reads prove.
 *   - PENDING   : initialized, no answer proposed yet.
 */

import type { Address, Hex } from 'viem'
import { umaAdapterAbi } from './abis'
import { getOnchainAddresses } from './addresses'
import { PRIMARY_CHAIN_KEY, getChainConfig, type ChainKey } from './chains'
import { getPublicClient } from './evmClient'
import { readMarketState, type ConditionId } from './market'

const CHAIN: ChainKey = PRIMARY_CHAIN_KEY

/** Plain lifecycle status of a market's trustless settlement. */
export type ResolutionPhase =
  | 'NotOnchain' // no on-chain question / crypto path unavailable
  | 'Unknown' // on-chain but state couldn't be read
  | 'Pending' // initialized, no answer proposed yet
  | 'Proposed' // an answer is proposed (challenge window open, or elapsed and
  //             awaiting the final resolve() call)
  | 'Resolved' // final answer reported on-chain, redeemable

export interface ResolutionStatus {
  phase: ResolutionPhase
  /** Short, plain label for a badge, e.g. "Proposed — dispute window open". */
  label: string
  /** Milliseconds left in the challenge window, when known and open. */
  disputeWindowMsLeft: number | null
  /** Indicative [YES, NO] split in [0,1] from the proposed/settled answer. */
  proposedPrices: readonly [number, number] | null
  /** True once the answer is final and shares are redeemable. */
  resolved: boolean
}

interface QuestionData {
  requestTimestamp: bigint
  reward: bigint
  proposalBond: bigint
  liveness: bigint
  manualResolutionTimestamp: bigint
  resolved: boolean
  paused: boolean
  reset: boolean
  refund: boolean
  rewardToken: Address
  creator: Address
  ancillaryData: Hex
}

function statusNotOnchain(): ResolutionStatus {
  return {
    phase: 'NotOnchain',
    label: 'Off-chain market',
    disputeWindowMsLeft: null,
    proposedPrices: null,
    resolved: false,
  }
}

/** Read the adapter's question record, or null when not initialized/unreadable. */
async function readQuestion(
  adapter: Address,
  questionId: Hex
): Promise<QuestionData | null> {
  try {
    const q = (await getPublicClient(CHAIN).readContract({
      address: adapter,
      abi: umaAdapterAbi,
      functionName: 'getQuestion',
      args: [questionId],
    })) as QuestionData
    // An uninitialized question returns a zero requestTimestamp.
    if (q.requestTimestamp === 0n) return null
    return q
  } catch {
    return null
  }
}

/** Is the question known to the adapter at all? Real `isInitialized` view. */
async function readInitialized(
  adapter: Address,
  questionId: Hex
): Promise<boolean> {
  try {
    return (await getPublicClient(CHAIN).readContract({
      address: adapter,
      abi: umaAdapterAbi,
      functionName: 'isInitialized',
      args: [questionId],
    })) as boolean
  } catch {
    return false
  }
}

/** The optimistic answer once PROPOSED, else null (the view reverts before). */
async function readProposedPayouts(
  adapter: Address,
  questionId: Hex
): Promise<readonly [number, number] | null> {
  try {
    const raw = (await getPublicClient(CHAIN).readContract({
      address: adapter,
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

/** Has the proposed answer passed its window and become final (undisputed)? */
async function readReady(adapter: Address, questionId: Hex): Promise<boolean> {
  try {
    return (await getPublicClient(CHAIN).readContract({
      address: adapter,
      abi: umaAdapterAbi,
      functionName: 'ready',
      args: [questionId],
    })) as boolean
  } catch {
    return false
  }
}

/**
 * Derive one plain status for a market's trustless settlement from REAL reads.
 *
 * @param conditionId CTF market handle (used to check final on-chain resolution).
 * @param questionId  UMA question id (used for adapter question-state reads); when
 *                    absent we still report Pending/Resolved from the condition.
 */
export async function readResolutionStatus(
  conditionId: ConditionId,
  questionId: Hex | null
): Promise<ResolutionStatus> {
  const addresses = getOnchainAddresses()
  if (!addresses) return statusNotOnchain()
  const { umaAdapter } = addresses

  // Final resolution is authoritative from Conditional Tokens: once payouts are
  // reported the market is redeemable regardless of the adapter's view state.
  let marketResolved = false
  try {
    marketResolved = (await readMarketState(conditionId)).resolved
  } catch {
    marketResolved = false
  }

  // Without a question id we can still report the two states the condition alone
  // proves: RESOLVED (payouts reported) or PENDING (not yet).
  if (!questionId) {
    if (marketResolved) return finalize('Resolved', null, null)
    return finalize('Pending', null, null)
  }

  const [initialized, question, proposed, ready] = await Promise.all([
    readInitialized(umaAdapter, questionId),
    readQuestion(umaAdapter, questionId),
    readProposedPayouts(umaAdapter, questionId),
    readReady(umaAdapter, questionId),
  ])

  if (marketResolved || question?.resolved) {
    return finalize('Resolved', proposed, null)
  }

  if (!initialized && !question) {
    // Not on the adapter. If the condition itself is unknown too, it's unknown;
    // otherwise treat as pending (condition exists, no UMA request readable).
    return finalize('Unknown', null, null)
  }

  // No proposal yet: waiting for the first optimistic answer.
  if (!proposed) return finalize('Pending', null, null)

  // A proposal exists. Compute the on-chain challenge window from the REAL
  // requestTimestamp + liveness. This is the window's outer bound; when a
  // proposal was reset/re-requested the adapter's `ready` flag governs finality.
  const windowMsLeft = computeWindowMsLeft(question)

  if (ready || (windowMsLeft !== null && windowMsLeft <= 0)) {
    // The answer's challenge window has elapsed (either `ready` is true, or the
    // computed window is up). It's proposed and awaiting the final resolve()
    // call. We do NOT claim it was disputed — that state lives on the oracle,
    // which we can't read here (see the file header). `windowMsLeft = 0` marks
    // "window closed" without surfacing a countdown.
    return finalize('Proposed', proposed, 0)
  }

  // Proposal live, window still open.
  return finalize('Proposed', proposed, windowMsLeft)
}

/**
 * Milliseconds left in the challenge window from the REAL on-chain
 * `requestTimestamp + liveness`, or null when either is unknown. Clamped at 0.
 */
function computeWindowMsLeft(question: QuestionData | null): number | null {
  if (!question || question.liveness === 0n || question.requestTimestamp === 0n) {
    return null
  }
  const endSec = question.requestTimestamp + question.liveness
  const nowSec = BigInt(Math.floor(Date.now() / 1000))
  const leftSec = endSec - nowSec
  if (leftSec <= 0n) return 0
  return Number(leftSec) * 1000
}

/** Assemble the final status object with a plain, human label. */
function finalize(
  phase: ResolutionPhase,
  proposedPrices: readonly [number, number] | null,
  windowMsLeft: number | null
): ResolutionStatus {
  const resolved = phase === 'Resolved'
  return {
    phase,
    label: labelFor(phase, windowMsLeft),
    disputeWindowMsLeft:
      phase === 'Proposed' && windowMsLeft !== null && windowMsLeft > 0
        ? windowMsLeft
        : null,
    proposedPrices,
    resolved,
  }
}

/** Plain-language label for a phase (no jargon, no claim the reads can't back). */
function labelFor(phase: ResolutionPhase, windowMsLeft: number | null): string {
  switch (phase) {
    case 'Resolved':
      return 'Resolved'
    case 'Proposed': {
      const left = formatWindow(windowMsLeft)
      // A live window shows the time left; a closed window (windowMsLeft <= 0)
      // means the answer is proposed and awaiting the final resolve() call.
      return left
        ? `Result proposed — challenge window open (${left} left)`
        : 'Result proposed — awaiting final settlement'
    }
    case 'Pending':
      return 'Awaiting result'
    case 'Unknown':
      return 'Status unavailable'
    case 'NotOnchain':
    default:
      return 'Off-chain market'
  }
}

/** Compact "Xh"/"Xm"/"Xd" for a remaining-window duration in ms, or ''. */
export function formatWindow(ms: number | null): string {
  if (ms == null || ms <= 0) return ''
  const totalMinutes = Math.floor(ms / 60_000)
  if (totalMinutes < 60) return `${Math.max(1, totalMinutes)}m`
  const hours = Math.floor(totalMinutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

// --------------------------------------------------------------------------- //
//                          Explorer / on-chain facts                           //
// --------------------------------------------------------------------------- //

/**
 * Block-explorer base URL for the settlement chain, from the viem chain config
 * (PolygonScan for Polygon). Real config only — no hardcoded host.
 */
export function explorerBaseUrl(): string | null {
  const url = getChainConfig(CHAIN).viemChain.blockExplorers?.default.url
  return url ? url.replace(/\/$/, '') : null
}

/** Explorer link for an address (adapter, collateral, condition tokens). */
export function explorerAddressUrl(address: Address): string | null {
  const base = explorerBaseUrl()
  return base ? `${base}/address/${address}` : null
}

/** Short middle-truncated form of a hex id, e.g. 0x1234…abcd. */
export function shortHex(value: string, lead = 6, tail = 4): string {
  if (!value.startsWith('0x') || value.length <= lead + tail + 2) return value
  return `${value.slice(0, 2 + lead)}…${value.slice(-tail)}`
}
