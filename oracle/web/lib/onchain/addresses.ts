import { Address, getAddress } from 'viem'
import { PRIMARY_CHAIN_KEY, usdcAddress, type ChainKey } from './chains'

// Deployed contract addresses for the on-chain (crypto) path. These come from
// NEXT_PUBLIC_* env vars — all PUBLIC (contract addresses are not secrets). When
// any required address is unset, the on-chain path is unavailable and the app
// stays fully on the off-chain (play-money) default.
//
// The user deploys Polymarket's REAL contracts DIRECTLY with each repo's own
// forge script (predikt-contracts/uma-ctf-adapter + ctf-exchange). The
// primitives (Gnosis ConditionalTokens, USDC, UMA OptimisticOracleV2) are
// ALREADY live on Polygon and are called at their real addresses.
//
// Required NEXT_PUBLIC_* env vars (documented in .env.local.template + DEPLOY):
//   NEXT_PUBLIC_ONCHAIN_UMA_ADAPTER          — deployed UmaCtfAdapter
//   NEXT_PUBLIC_ONCHAIN_EXCHANGE             — deployed CTF Exchange
//   NEXT_PUBLIC_ONCHAIN_CONDITIONAL_TOKENS   — Gnosis ConditionalTokens (Polygon)
//   NEXT_PUBLIC_ONCHAIN_UMA_OPTIMISTIC_ORACLE— UMA OptimisticOracleV2 (Polygon)
//   NEXT_PUBLIC_ONCHAIN_USDC (optional)      — overrides the canonical USDC below

export interface OnchainAddresses {
  chainKey: ChainKey
  /** Polymarket UmaCtfAdapter — question init + trustless UMA resolution. */
  umaAdapter: Address
  /** Polymarket CTF Exchange — signed-order trading of outcome tokens. */
  exchange: Address
  /** Gnosis ConditionalTokens — split / merge / redeem / positions. */
  conditionalTokens: Address
  /** UMA OptimisticOracleV2 — the settlement oracle the adapter requests from. */
  umaOptimisticOracle: Address
  /** USDC collateral (6 decimals) on the settlement chain. */
  usdc: Address
  /**
   * Predikt FPMMDeterministicFactory — the AMM factory that creates + funds the
   * Fixed Product Market Maker pools used for instant liquidity. OPTIONAL: when
   * unset the AMM path is simply unavailable and the router falls back to the
   * CLOB (or the trade box hides AMM execution), leaving the CLOB path intact.
   */
  fpmmFactory?: Address
}

function envAddress(name: string): Address | undefined {
  // Direct property access so Next.js can statically inline NEXT_PUBLIC_* vars.
  const table: Record<string, string | undefined> = {
    NEXT_PUBLIC_ONCHAIN_UMA_ADAPTER: process.env.NEXT_PUBLIC_ONCHAIN_UMA_ADAPTER,
    NEXT_PUBLIC_ONCHAIN_EXCHANGE: process.env.NEXT_PUBLIC_ONCHAIN_EXCHANGE,
    NEXT_PUBLIC_ONCHAIN_CONDITIONAL_TOKENS:
      process.env.NEXT_PUBLIC_ONCHAIN_CONDITIONAL_TOKENS,
    NEXT_PUBLIC_ONCHAIN_UMA_OPTIMISTIC_ORACLE:
      process.env.NEXT_PUBLIC_ONCHAIN_UMA_OPTIMISTIC_ORACLE,
    NEXT_PUBLIC_ONCHAIN_USDC: process.env.NEXT_PUBLIC_ONCHAIN_USDC,
    NEXT_PUBLIC_ONCHAIN_FPMM_FACTORY:
      process.env.NEXT_PUBLIC_ONCHAIN_FPMM_FACTORY,
  }
  const raw = table[name]
  if (!raw) return undefined
  try {
    return getAddress(raw.trim())
  } catch {
    return undefined
  }
}

/**
 * Resolve the deployed contract addresses for the primary settlement chain.
 * Returns null when the deployment isn't fully configured, which keeps every
 * on-chain feature hidden and the play-money default fully intact.
 */
export function getOnchainAddresses(): OnchainAddresses | null {
  const chainKey = PRIMARY_CHAIN_KEY

  const umaAdapter = envAddress('NEXT_PUBLIC_ONCHAIN_UMA_ADAPTER')
  const exchange = envAddress('NEXT_PUBLIC_ONCHAIN_EXCHANGE')
  const conditionalTokens = envAddress(
    'NEXT_PUBLIC_ONCHAIN_CONDITIONAL_TOKENS'
  )
  const umaOptimisticOracle = envAddress(
    'NEXT_PUBLIC_ONCHAIN_UMA_OPTIMISTIC_ORACLE'
  )
  const usdc = envAddress('NEXT_PUBLIC_ONCHAIN_USDC') ?? usdcAddress(chainKey)
  // Optional — the AMM path is enabled only when this is set.
  const fpmmFactory = envAddress('NEXT_PUBLIC_ONCHAIN_FPMM_FACTORY')

  if (!umaAdapter || !exchange || !conditionalTokens || !umaOptimisticOracle) {
    return null
  }

  return {
    chainKey,
    umaAdapter,
    exchange,
    conditionalTokens,
    umaOptimisticOracle,
    usdc,
    fpmmFactory,
  }
}

/** Whether the on-chain (crypto) path is available at all in this deployment. */
export function isOnchainEnabled(): boolean {
  return getOnchainAddresses() !== null
}

// USDC has 6 decimals on Polygon.
export const USDC_DECIMALS = 6
