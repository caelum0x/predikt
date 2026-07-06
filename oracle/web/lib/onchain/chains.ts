/**
 * EVM chain registry for the on-chain (real-money) path.
 *
 * Ported from the native wallet's `evmChains.ts` + `rpcEndpoints.ts`, trimmed
 * to the chains this app settles on. Polygon is PRIMARY — it is where the
 * Predikt market contracts are deployed and where USDC collateral settles (see
 * `predikt-contracts/script/Config.sol`). Base/Arbitrum/Optimism/Ethereum are
 * included so a user's existing USDC on those chains is visible/spendable.
 *
 * Every chain here uses the identical secp256k1 / `m/44'/60'/0'/0/0`
 * derivation — one address is valid on all of them.
 *
 * RPC: free, keyless PublicNode endpoints by default. An OPTIONAL env override
 * (`NEXT_PUBLIC_RPC_<KEY>`, e.g. `NEXT_PUBLIC_RPC_POLYGON`) points at a paid
 * provider when present. NEVER hardcode a secret here — the public endpoints
 * are shared by design.
 *
 * USDC addresses are the canonical Circle-issued NATIVE USDC per chain and, for
 * Polygon, match the collateral token in the Predikt contracts exactly.
 */

import { arbitrum, base, mainnet, optimism, polygon } from 'viem/chains'
import type { Address, Chain } from 'viem'

export type ChainKey =
  | 'polygon'
  | 'base'
  | 'arbitrum'
  | 'optimism'
  | 'ethereum'

export interface EvmChainConfig {
  /** Stable key used across state — lowercase, no spaces. */
  key: ChainKey
  /** Human-readable name shown in the UI. */
  displayName: string
  /** Native gas currency ticker. */
  ticker: string
  /** EIP-155 chain id (mainnet). */
  chainId: number
  /** viem chain definition (used to build clients). */
  viemChain: Chain
  /** Free, keyless public HTTP JSON-RPC endpoint (default transport). */
  publicRpcHttp: string
  /**
   * Env var name for an OPTIONAL private RPC override. When set, its value is
   * used instead of `publicRpcHttp`. Must be a NEXT_PUBLIC_* var to be
   * readable in the browser bundle.
   */
  rpcEnvVar: string
  /** Canonical native (Circle-issued) USDC token address on this chain. */
  usdc: Address
}

/**
 * The chain the app settles on. Predikt markets + USDC collateral live here.
 */
export const PRIMARY_CHAIN_KEY: ChainKey = 'polygon'

export const EVM_CHAINS: Record<ChainKey, EvmChainConfig> = {
  polygon: {
    key: 'polygon',
    displayName: 'Polygon',
    ticker: 'POL',
    chainId: 137,
    viemChain: polygon,
    publicRpcHttp: 'https://polygon-bor-rpc.publicnode.com',
    rpcEnvVar: 'NEXT_PUBLIC_RPC_POLYGON',
    // Native USDC on Polygon — matches predikt-contracts Config.USDC_POLYGON.
    usdc: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
  },
  base: {
    key: 'base',
    displayName: 'Base',
    ticker: 'ETH',
    chainId: 8453,
    viemChain: base,
    publicRpcHttp: 'https://base-rpc.publicnode.com',
    rpcEnvVar: 'NEXT_PUBLIC_RPC_BASE',
    // Native USDC on Base.
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  },
  arbitrum: {
    key: 'arbitrum',
    displayName: 'Arbitrum One',
    ticker: 'ETH',
    chainId: 42161,
    viemChain: arbitrum,
    publicRpcHttp: 'https://arbitrum-one-rpc.publicnode.com',
    rpcEnvVar: 'NEXT_PUBLIC_RPC_ARBITRUM',
    // Native USDC on Arbitrum One (not bridged USDC.e).
    usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  },
  optimism: {
    key: 'optimism',
    displayName: 'Optimism',
    ticker: 'ETH',
    chainId: 10,
    viemChain: optimism,
    publicRpcHttp: 'https://optimism-rpc.publicnode.com',
    rpcEnvVar: 'NEXT_PUBLIC_RPC_OPTIMISM',
    // Native USDC on Optimism (not bridged USDC.e).
    usdc: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
  },
  ethereum: {
    key: 'ethereum',
    displayName: 'Ethereum',
    ticker: 'ETH',
    chainId: 1,
    viemChain: mainnet,
    publicRpcHttp: 'https://ethereum-rpc.publicnode.com',
    rpcEnvVar: 'NEXT_PUBLIC_RPC_ETHEREUM',
    // Circle USDC on Ethereum mainnet.
    usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  },
}

/** Ordered list, primary first. */
export const CHAIN_ORDER: ChainKey[] = [
  'polygon',
  'base',
  'arbitrum',
  'optimism',
  'ethereum',
]

export function getChainConfig(key: ChainKey): EvmChainConfig {
  const config = EVM_CHAINS[key]
  if (!config) throw new Error(`Unknown chain: ${key}`)
  return config
}

export function getChainConfigById(chainId: number): EvmChainConfig | undefined {
  return Object.values(EVM_CHAINS).find((c) => c.chainId === chainId)
}

/**
 * Resolve the HTTP RPC URL for a chain: an env override if present, otherwise
 * the free public endpoint. Reads `process.env[rpcEnvVar]` — only NEXT_PUBLIC_*
 * vars are inlined into the browser bundle by Next.js.
 */
export function resolveRpcHttp(key: ChainKey): string {
  const config = getChainConfig(key)
  // Direct property access so Next.js can statically inline NEXT_PUBLIC_* vars.
  const overrides: Record<string, string | undefined> = {
    NEXT_PUBLIC_RPC_POLYGON: process.env.NEXT_PUBLIC_RPC_POLYGON,
    NEXT_PUBLIC_RPC_BASE: process.env.NEXT_PUBLIC_RPC_BASE,
    NEXT_PUBLIC_RPC_ARBITRUM: process.env.NEXT_PUBLIC_RPC_ARBITRUM,
    NEXT_PUBLIC_RPC_OPTIMISM: process.env.NEXT_PUBLIC_RPC_OPTIMISM,
    NEXT_PUBLIC_RPC_ETHEREUM: process.env.NEXT_PUBLIC_RPC_ETHEREUM,
  }
  const override = overrides[config.rpcEnvVar]
  return override && override.length > 0 ? override : config.publicRpcHttp
}

/** Canonical USDC address for a chain (matches the Predikt collateral token). */
export function usdcAddress(key: ChainKey): Address {
  return getChainConfig(key).usdc
}
