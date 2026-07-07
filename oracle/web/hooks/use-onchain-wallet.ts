import { useCallback, useEffect, useRef, useState } from 'react'
import { formatUnits, type Address } from 'viem'
import { USDC_DECIMALS } from 'web/lib/onchain/addresses'
import { readUsdcBalance } from 'web/lib/onchain/market'
import {
  createWallet,
  getAddress,
  hasWallet,
  importWallet,
  wipe,
} from 'web/lib/onchain/wallet'

export interface OnchainWalletState {
  ready: boolean
  address: Address | null
  usdc: bigint | null
  usdcFormatted: string | null
  loading: boolean
  error: string | null
  /**
   * Reconcile address + USDC balance from the chain. Interval-guarded: calls
   * that land within `REFRESH_MIN_INTERVAL_MS` of the last successful refresh
   * are coalesced (skipped) to avoid redundant RPC traffic on re-render/effect
   * churn. Pass `{ force: true }` after an explicit user action (a trade, a
   * create/import) to bypass the guard and read the freshest state.
   */
  refresh: (opts?: { force?: boolean }) => Promise<void>
  create: () => Promise<void>
  importPhrase: (phrase: string) => Promise<void>
  disconnect: () => Promise<void>
}

/**
 * Minimum spacing between balance/position RPC reads. Effect- and render-driven
 * refreshes that arrive faster than this are coalesced; explicit user actions
 * bypass it via `refresh({ force: true })`.
 */
const REFRESH_MIN_INTERVAL_MS = 15_000

/**
 * Client-only hook exposing the self-custodial on-chain wallet: its address,
 * live USDC balance, and create/import/disconnect actions. Never touches the
 * off-chain (play-money) flow. Balance reads are REAL RPC calls.
 */
export function useOnchainWallet(): OnchainWalletState {
  const [ready, setReady] = useState(false)
  const [address, setAddress] = useState<Address | null>(null)
  const [usdc, setUsdc] = useState<bigint | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Guard against setState-after-unmount: the initial refresh + every balance
  // read is an async RPC call, so the component can unmount before they settle.
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // Interval guard for coalescing redundant refreshes. `lastRefreshRef` records
  // the timestamp of the last refresh that actually hit the network; `inFlightRef`
  // dedupes concurrent calls so overlapping effects share one RPC round-trip.
  const lastRefreshRef = useRef(0)
  const inFlightRef = useRef<Promise<void> | null>(null)

  const loadBalance = useCallback(async (addr: Address) => {
    try {
      const bal = await readUsdcBalance(addr)
      if (mountedRef.current) setUsdc(bal)
    } catch (e) {
      // Balance read is non-fatal; keep the address usable.
      if (mountedRef.current) setUsdc(null)
    }
  }, [])

  const doRefresh = useCallback(async () => {
    setError(null)
    if (!hasWallet()) {
      if (mountedRef.current) {
        setAddress(null)
        setUsdc(null)
        setReady(true)
      }
      return
    }
    const addr = await getAddress()
    if (!mountedRef.current) return
    setAddress(addr)
    setReady(true)
    if (addr) await loadBalance(addr)
  }, [loadBalance])

  const refresh = useCallback(
    async (opts?: { force?: boolean }) => {
      const now = Date.now()
      // Coalesce render/effect-driven refreshes that arrive within the guard
      // window, unless the caller explicitly forces a fresh read after an action.
      if (
        !opts?.force &&
        lastRefreshRef.current !== 0 &&
        now - lastRefreshRef.current < REFRESH_MIN_INTERVAL_MS
      ) {
        return
      }
      // Dedupe concurrent refreshes so overlapping effects share one RPC pass.
      if (inFlightRef.current) return inFlightRef.current
      const run = (async () => {
        try {
          await doRefresh()
        } finally {
          lastRefreshRef.current = Date.now()
          inFlightRef.current = null
        }
      })()
      inFlightRef.current = run
      return run
    },
    [doRefresh]
  )

  useEffect(() => {
    // Force the initial mount read (the guard is only meaningful after the
    // first successful refresh), while still respecting the mount-guard fix.
    refresh({ force: true })
  }, [refresh])

  const create = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const addr = await createWallet()
      if (!mountedRef.current) return
      setAddress(addr)
      await loadBalance(addr)
      lastRefreshRef.current = Date.now()
    } catch (e) {
      if (mountedRef.current)
        setError(e instanceof Error ? e.message : 'Could not create wallet.')
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [loadBalance])

  const importPhrase = useCallback(
    async (phrase: string) => {
      setLoading(true)
      setError(null)
      try {
        const addr = await importWallet(phrase)
        if (mountedRef.current) {
          setAddress(addr)
          await loadBalance(addr)
          lastRefreshRef.current = Date.now()
        }
      } catch (e) {
        if (mountedRef.current)
          setError(e instanceof Error ? e.message : 'Could not import wallet.')
        throw e
      } finally {
        if (mountedRef.current) setLoading(false)
      }
    },
    [loadBalance]
  )

  const disconnect = useCallback(async () => {
    await wipe()
    setAddress(null)
    setUsdc(null)
    // Reset the guard so the next connect/refresh reads immediately.
    lastRefreshRef.current = 0
  }, [])

  return {
    ready,
    address,
    usdc,
    usdcFormatted:
      usdc == null ? null : formatUnits(usdc, USDC_DECIMALS),
    loading,
    error,
    refresh,
    create,
    importPhrase,
    disconnect,
  }
}
