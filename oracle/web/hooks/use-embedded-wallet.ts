'use client'
import { useCallback, useEffect, useState } from 'react'
import { formatUnits, type Address } from 'viem'
import { isOnchainEnabled, USDC_DECIMALS } from 'web/lib/onchain/addresses'
import { readUsdcBalance } from 'web/lib/onchain/market'
import { createWallet, getAddress, hasWallet } from 'web/lib/onchain/wallet'
import { useUser } from 'web/hooks/use-user'

/**
 * The embedded-wallet state surfaced to the UI. Crypto is invisible: the user
 * never sees a "connect wallet" step — signing in auto-provisions an encrypted
 * device wallet the first time (only when the on-chain path is enabled).
 */
export interface EmbeddedWalletState {
  /** True once provisioning has settled (wallet exists or on-chain is off). */
  ready: boolean
  /** Derived EVM address, or null when off-chain / not yet provisioned. */
  address: Address | null
  /** Live USDC balance in base units (6 decimals), or null if unread. */
  usdcBalance: bigint | null
  /** Human-readable USDC balance (e.g. "12.50"), or null if unread. */
  usdcFormatted: string | null
  /** True while the initial silent provisioning is in flight. */
  provisioning: boolean
  /** Re-read the address + balance from storage/chain. */
  refresh: () => Promise<void>
}

const OFF: EmbeddedWalletState = {
  ready: true,
  address: null,
  usdcBalance: null,
  usdcFormatted: null,
  provisioning: false,
  refresh: async () => {},
}

/**
 * Auto-provision + expose the embedded on-chain wallet.
 *
 * Behavior:
 *  - When `isOnchainEnabled()` is false (the OFF-CHAIN DEFAULT), this is a no-op
 *    and returns an inert OFF state — nothing about the play-money app changes.
 *  - When on-chain is enabled AND the user is authenticated AND no wallet is
 *    stored yet, it silently `createWallet()`s one (generate + encrypt + persist
 *    locally) so on-chain markets work with NO separate connect step. The seed
 *    phrase is never surfaced (createWallet never returns it).
 *  - Idempotent: if a wallet already exists it is reused, never re-created.
 *
 * Balance reads are REAL RPC calls and are best-effort (non-fatal on failure).
 */
export function useEmbeddedWallet(): EmbeddedWalletState {
  const user = useUser()
  const enabled = isOnchainEnabled()

  const [ready, setReady] = useState(false)
  const [address, setAddress] = useState<Address | null>(null)
  const [usdcBalance, setUsdcBalance] = useState<bigint | null>(null)
  const [provisioning, setProvisioning] = useState(false)

  const loadBalance = useCallback(async (addr: Address) => {
    try {
      setUsdcBalance(await readUsdcBalance(addr))
    } catch {
      // Balance read is non-fatal; the address stays usable.
      setUsdcBalance(null)
    }
  }, [])

  const refresh = useCallback(async () => {
    if (!enabled) return
    const addr = await getAddress()
    setAddress(addr)
    setReady(true)
    if (addr) await loadBalance(addr)
  }, [enabled, loadBalance])

  useEffect(() => {
    if (!enabled) {
      // Off-chain default: stay inert.
      setReady(true)
      return
    }
    // Only provision once we know who the user is — gate on an authenticated
    // session so we don't create wallets for logged-out visitors.
    if (!user) {
      setReady(false)
      return
    }

    let cancelled = false
    const provision = async () => {
      try {
        if (hasWallet()) {
          // Idempotent path: reuse the existing device wallet.
          const addr = await getAddress()
          if (cancelled) return
          setAddress(addr)
          if (addr) await loadBalance(addr)
          return
        }
        // First authenticated load with on-chain enabled: create silently.
        setProvisioning(true)
        const addr = await createWallet()
        if (cancelled) return
        setAddress(addr)
        await loadBalance(addr)
      } catch {
        // Provisioning failure must never break the play-money experience;
        // the user simply won't have an on-chain balance until a later retry.
        if (!cancelled) setAddress(null)
      } finally {
        if (!cancelled) {
          setProvisioning(false)
          setReady(true)
        }
      }
    }

    provision()
    return () => {
      cancelled = true
    }
  }, [enabled, user?.id, loadBalance])

  if (!enabled) return OFF

  return {
    ready,
    address,
    usdcBalance,
    usdcFormatted:
      usdcBalance == null ? null : formatUnits(usdcBalance, USDC_DECIMALS),
    provisioning,
    refresh,
  }
}
