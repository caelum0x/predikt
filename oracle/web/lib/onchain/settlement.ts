import { isHex } from 'viem'
import { isOnchainEnabled } from './addresses'
import { getOnchainDeployment } from './registry'
import type { ConditionId } from './market'

/**
 * Settlement routing: does a market settle trustlessly on-chain (crypto/USDC via
 * the real Polymarket contracts) or off-chain with play money? The whole app
 * defaults to OFF-CHAIN — on-chain is strictly opt-in per market. Nothing here
 * changes the play-money experience.
 *
 * A market is on-chain when EITHER:
 *   - it carries an on-chain tag: an `onchainConditionId` (set at creation when
 *     the crypto path is chosen) or a local registry deployment, OR
 *   - it belongs to a crypto/USDC settlement group (slug membership).
 *
 * The on-chain path is only ever reported when the deployment is configured
 * (`isOnchainEnabled()`), so a misconfigured build silently stays off-chain.
 */

export type Settlement = 'onchain' | 'offchain'

/** Group slugs that mark a market as on-chain / USDC-settled. */
export const ONCHAIN_GROUP_SLUGS = ['crypto', 'usdc', 'onchain'] as const

/**
 * The optional on-chain fields a market may carry. These are additive: an
 * off-chain market simply doesn't have them. Kept as a standalone shape so we
 * never have to widen the core Contract type.
 */
export interface OnchainMarketTag {
  /** CTF conditionId — the on-chain market handle for trading/redeem. */
  onchainConditionId?: string
  /** UMA/CTF question id (for permissionless resolve). */
  onchainQuestionId?: string
  /** Explicit settlement flag, if the backend stored one. */
  settlement?: Settlement
}

/** A minimal contract shape this module reads. Accepts the full Contract too. */
export interface SettlementReadable extends OnchainMarketTag {
  id?: string
  groupSlugs?: string[]
}

function hasOnchainGroup(groupSlugs?: string[]): boolean {
  if (!groupSlugs || groupSlugs.length === 0) return false
  const set = new Set(groupSlugs.map((s) => s.toLowerCase()))
  return ONCHAIN_GROUP_SLUGS.some((slug) => set.has(slug))
}

function isConditionId(value?: string): value is ConditionId {
  return !!value && isHex(value) && value.length === 66
}

/**
 * Determine how a market settles. Defaults to 'offchain'. Only returns
 * 'onchain' when the deployment is configured AND the market is tagged on-chain
 * (conditionId field, local registry entry, explicit settlement flag, or
 * crypto/USDC group membership).
 */
export function settlementOf(contract: SettlementReadable): Settlement {
  if (!isOnchainEnabled()) return 'offchain'

  if (contract.settlement === 'onchain') return 'onchain'
  if (contract.settlement === 'offchain') return 'offchain'

  if (isConditionId(contract.onchainConditionId)) return 'onchain'
  if (contract.id && getOnchainDeployment(contract.id)) return 'onchain'
  if (hasOnchainGroup(contract.groupSlugs)) return 'onchain'

  return 'offchain'
}

/** Convenience predicate. */
export function isOnchainMarket(contract: SettlementReadable): boolean {
  return settlementOf(contract) === 'onchain'
}

/**
 * The CTF conditionId (on-chain market handle) for an on-chain market, or null.
 * Reads the `onchainConditionId` tag, falling back to the local registry.
 * Returns null for off-chain markets.
 */
export function conditionIdOf(contract: SettlementReadable): ConditionId | null {
  if (isConditionId(contract.onchainConditionId)) {
    return contract.onchainConditionId
  }
  if (contract.id) {
    const deployment = getOnchainDeployment(contract.id)
    if (deployment) return deployment.conditionId
  }
  return null
}

/** The UMA question id for an on-chain market, or null. */
export function questionIdOf(
  contract: SettlementReadable
): `0x${string}` | null {
  const q = contract.onchainQuestionId
  if (q && /^0x[0-9a-fA-F]{64}$/.test(q)) return q as `0x${string}`
  if (contract.id) {
    const deployment = getOnchainDeployment(contract.id)
    if (deployment) return deployment.questionId
  }
  return null
}
