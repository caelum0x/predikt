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
  refresh: () => Promise<void>
  create: () => Promise<void>
  importPhrase: (phrase: string) => Promise<void>
  disconnect: () => Promise<void>
}

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

  const loadBalance = useCallback(async (addr: Address) => {
    try {
      const bal = await readUsdcBalance(addr)
      if (mountedRef.current) setUsdc(bal)
    } catch (e) {
      // Balance read is non-fatal; keep the address usable.
      if (mountedRef.current) setUsdc(null)
    }
  }, [])

  const refresh = useCallback(async () => {
    setError(null)
    if (!hasWallet()) {
      setAddress(null)
      setUsdc(null)
      setReady(true)
      return
    }
    const addr = await getAddress()
    if (!mountedRef.current) return
    setAddress(addr)
    setReady(true)
    if (addr) await loadBalance(addr)
  }, [loadBalance])

  useEffect(() => {
    refresh()
  }, [refresh])

  const create = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const addr = await createWallet()
      if (!mountedRef.current) return
      setAddress(addr)
      await loadBalance(addr)
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
