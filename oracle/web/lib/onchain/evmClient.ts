/**
 * Chain-agnostic EVM client built on viem.
 *
 * Ported (conceptually) from the native wallet's `EvmService`, but re-expressed
 * with viem `publicClient` / `walletClient` instead of ethers. All calls here
 * are REAL on-chain reads/writes against the resolved RPC — no mocks.
 *
 * Reads use a cached `publicClient` per chain. Writes require a `walletClient`
 * that the wallet layer builds after unlocking (see `wallet.ts`); this module
 * never sees the mnemonic or private key.
 */

import {
  createPublicClient,
  erc20Abi,
  http,
  type Account,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem'
import {
  getChainConfig,
  resolveRpcHttp,
  usdcAddress,
  type ChainKey,
} from './chains'

const publicClients: Partial<Record<ChainKey, PublicClient>> = {}

/** Get (or lazily build + cache) the read-only client for a chain. */
export function getPublicClient(key: ChainKey): PublicClient {
  const cached = publicClients[key]
  if (cached) return cached
  const config = getChainConfig(key)
  const client = createPublicClient({
    chain: config.viemChain,
    transport: http(resolveRpcHttp(key)),
  }) as PublicClient
  publicClients[key] = client
  return client
}

/** Native gas-token balance (wei) for an address on a chain. */
export async function nativeBalance(
  key: ChainKey,
  address: Address
): Promise<bigint> {
  return getPublicClient(key).getBalance({ address })
}

/** ERC-20 balance (base units) of `token` held by `owner`. */
export async function erc20Balance(
  key: ChainKey,
  token: Address,
  owner: Address
): Promise<bigint> {
  return getPublicClient(key).readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [owner],
  })
}

/** ERC-20 decimals for `token` (USDC is 6 on every chain here). */
export async function erc20Decimals(
  key: ChainKey,
  token: Address
): Promise<number> {
  return getPublicClient(key).readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'decimals',
  })
}

/** Current ERC-20 allowance `owner` has granted `spender` for `token`. */
export async function allowance(
  key: ChainKey,
  token: Address,
  owner: Address,
  spender: Address
): Promise<bigint> {
  return getPublicClient(key).readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [owner, spender],
  })
}

/** Convenience: USDC balance (base units) for `owner` on a chain. */
export function usdcBalance(key: ChainKey, owner: Address): Promise<bigint> {
  return erc20Balance(key, usdcAddress(key), owner)
}

/** Convenience: USDC decimals for a chain (reads on-chain, expected 6). */
export function usdcDecimals(key: ChainKey): Promise<number> {
  return erc20Decimals(key, usdcAddress(key))
}

/** Request parameters for an ERC-20 write, ready to pass to a wallet client. */
export interface Erc20WriteRequest {
  address: Address
  abi: typeof erc20Abi
  functionName: 'approve' | 'transfer'
  args: readonly [Address, bigint]
}

/**
 * Build (do not send) an ERC-20 `approve(spender, amount)` request. Returned
 * shape is fed straight into `sendErc20Write`.
 */
export function buildApprove(
  token: Address,
  spender: Address,
  amount: bigint
): Erc20WriteRequest {
  return {
    address: token,
    abi: erc20Abi,
    functionName: 'approve',
    args: [spender, amount],
  }
}

/** Build (do not send) an ERC-20 `transfer(to, amount)` request. */
export function buildTransfer(
  token: Address,
  to: Address,
  amount: bigint
): Erc20WriteRequest {
  return {
    address: token,
    abi: erc20Abi,
    functionName: 'transfer',
    args: [to, amount],
  }
}

/**
 * Simulate then send an ERC-20 write with the caller's `walletClient`. The
 * simulation surfaces reverts (insufficient balance, etc.) before broadcasting.
 * Returns the transaction hash.
 */
export async function sendErc20Write(
  key: ChainKey,
  account: Account,
  walletClient: WalletClient,
  request: Erc20WriteRequest
): Promise<Hex> {
  const config = getChainConfig(key)
  const publicClient = getPublicClient(key)

  const { request: simulated } = await publicClient.simulateContract({
    account,
    address: request.address,
    abi: request.abi,
    functionName: request.functionName,
    args: request.args,
  })

  return walletClient.writeContract({
    ...simulated,
    account,
    chain: config.viemChain,
  })
}

/** Wait for a transaction receipt (1 confirmation) and return its status. */
export async function waitForReceipt(key: ChainKey, hash: Hex) {
  return getPublicClient(key).waitForTransactionReceipt({ hash })
}
