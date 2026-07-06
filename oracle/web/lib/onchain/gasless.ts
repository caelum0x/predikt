/**
 * Gasless (ERC-4337) integration seam for sponsored first-trades.
 *
 * GOAL: let a brand-new user place their first on-chain trade WITHOUT holding
 * any native gas token (POL/MATIC), by having a paymaster sponsor the gas. This
 * removes the single biggest "crypto is visible" wall in the funnel.
 *
 * STATUS: this is a typed, documented INTEGRATION POINT — not a hardcoded paid
 * service. It reads `NEXT_PUBLIC_PAYMASTER_URL` (a free-tier bundler/paymaster
 * RPC endpoint). When that env is UNSET, `isGaslessEnabled()` is false and the
 * caller MUST fall back to the current behavior (the user pays their own gas via
 * the normal viem walletClient path in evmClient.ts). Nothing here changes the
 * off-chain default.
 *
 * NO SECRETS: a paymaster/bundler RPC URL is a public endpoint (like an RPC
 * URL). Do not put private keys or API secrets that must stay server-side into a
 * NEXT_PUBLIC_* var. If your provider requires a secret API key, proxy it through
 * your own backend route and point NEXT_PUBLIC_PAYMASTER_URL at that route.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * HOW TO PLUG IN A FREE-TIER PAYMASTER (choose one):
 *
 *  1. Deploy/point at an ERC-4337 bundler that also offers a paymaster. Several
 *     providers have free tiers with a monthly sponsored-gas allowance suitable
 *     for onboarding first-trades. Any EIP-4337 compliant bundler works; the
 *     shape below is provider-agnostic.
 *  2. Set `NEXT_PUBLIC_PAYMASTER_URL` to that endpoint in `.env.local`.
 *  3. Implement `sponsorUserOp` against your provider's paymaster RPC
 *     (`pm_sponsorUserOperation` is the de-facto standard method) and wire the
 *     returned paymaster fields into a UserOperation you submit through the
 *     bundler (`eth_sendUserOperation`). The account layer would use a smart
 *     account (e.g. a SimpleAccount / Kernel / Safe4337 module) derived from the
 *     same embedded key — that account-abstraction wiring is intentionally left
 *     as the next implementation step and is documented in docs/ONBOARDING.md.
 *
 * This module deliberately stops at the seam: it defines the types and the
 * sponsor call, so the rest of the app can branch on `isGaslessEnabled()` today
 * and the full 4337 account wiring can land without touching call sites.
 * ────────────────────────────────────────────────────────────────────────────
 */

import type { Address, Hex } from 'viem'

/** Read the configured paymaster endpoint (public RPC URL), if any. */
export function getPaymasterUrl(): string | undefined {
  const raw = process.env.NEXT_PUBLIC_PAYMASTER_URL
  const trimmed = raw?.trim()
  return trimmed ? trimmed : undefined
}

/**
 * Whether gasless sponsorship is configured. When false, on-chain txs fall back
 * to the user paying their own gas (current, unchanged behavior).
 */
export function isGaslessEnabled(): boolean {
  return getPaymasterUrl() !== undefined
}

/**
 * The unsigned UserOperation fields a paymaster needs to price sponsorship.
 * Mirrors the EIP-4337 UserOperation (v0.6) shape. `signature` is typically a
 * dummy at sponsorship time and replaced with the real signature before submit.
 */
export interface UserOperationRequest {
  sender: Address
  nonce: Hex
  initCode: Hex
  callData: Hex
  callGasLimit: Hex
  verificationGasLimit: Hex
  preVerificationGas: Hex
  maxFeePerGas: Hex
  maxPriorityFeePerGas: Hex
  paymasterAndData: Hex
  signature: Hex
}

/**
 * The paymaster fields returned by a successful sponsorship. Merge these into
 * the UserOperation before signing + submitting to the bundler.
 */
export interface SponsorResult {
  paymasterAndData: Hex
  /** Providers often re-quote gas as part of sponsorship; apply if present. */
  preVerificationGas?: Hex
  verificationGasLimit?: Hex
  callGasLimit?: Hex
}

/** The EntryPoint a UserOperation targets (v0.6 canonical address by default). */
export const DEFAULT_ENTRY_POINT: Address =
  '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789'

export interface SponsorParams {
  userOp: UserOperationRequest
  entryPoint?: Address
}

/**
 * Ask the configured paymaster to sponsor a UserOperation.
 *
 * Returns null when gasless is not configured — callers treat null as "sponsor
 * unavailable, fall back to user-paid gas". Throws only on a real transport /
 * provider error so the caller can decide whether to surface it or fall back.
 *
 * Implementation note: this issues the de-facto-standard JSON-RPC
 * `pm_sponsorUserOperation`. Some providers namespace it differently; adjust the
 * method name for your chosen free-tier provider (documented in ONBOARDING.md).
 */
export async function sponsorUserOp(
  params: SponsorParams
): Promise<SponsorResult | null> {
  const url = getPaymasterUrl()
  if (!url) return null

  const entryPoint = params.entryPoint ?? DEFAULT_ENTRY_POINT

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'pm_sponsorUserOperation',
      params: [params.userOp, entryPoint],
    }),
  })

  if (!res.ok) {
    throw new Error(`Paymaster request failed: ${res.status}`)
  }

  const json = (await res.json()) as {
    result?: SponsorResult
    error?: { message?: string }
  }

  if (json.error) {
    throw new Error(json.error.message ?? 'Paymaster declined sponsorship.')
  }
  if (!json.result?.paymasterAndData) {
    return null
  }
  return json.result
}
