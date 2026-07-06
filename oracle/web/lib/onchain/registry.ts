import { isHex } from 'viem'

/**
 * Local registry mapping an off-chain contract id to its on-chain market
 * identity: the CTF `conditionId` (the market handle used by market.ts) plus the
 * UMA `questionId` (for permissionless resolve) and the derived YES/NO position
 * ids.
 *
 * When a market is created with the on-chain (crypto) option, the
 * UmaCtfAdapter.initialize() transaction yields these ids. The play-money
 * backend record isn't extended here (no schema change), so we persist the
 * deployment locally on the creator's device and expose it to the settlement +
 * trade layers. The market is ALSO tagged with the `crypto` group at creation so
 * the on-chain marker shows for everyone; the trade box needs the conditionId,
 * which lives here (or in a market field / a future backend column).
 */

const STORAGE_KEY = 'predikt-onchain-registry-v1'

export interface OnchainDeployment {
  /** CTF conditionId — the on-chain market handle for reads/trades/redeem. */
  conditionId: `0x${string}`
  /** UMA/CTF questionId — used for permissionless resolve. */
  questionId: `0x${string}`
  /** Derived [YES, NO] ERC-1155 position ids (decimal strings for storage). */
  positionIds?: [string, string]
}

type Registry = Record<string, OnchainDeployment>

function isBrowser(): boolean {
  return typeof window !== 'undefined' && !!window.localStorage
}

function read(): Registry {
  if (!isBrowser()) return {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Registry) : {}
  } catch {
    return {}
  }
}

/** Record an on-chain deployment for a contract id. */
export function registerOnchainMarket(
  contractId: string,
  deployment: OnchainDeployment
): void {
  if (!isBrowser()) return
  const reg = read()
  reg[contractId] = deployment
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(reg))
}

/** Look up a contract's on-chain deployment, or null. */
export function getOnchainDeployment(
  contractId: string
): OnchainDeployment | null {
  const d = read()[contractId]
  if (d && isHex(d.conditionId) && d.conditionId.length === 66) return d
  return null
}
