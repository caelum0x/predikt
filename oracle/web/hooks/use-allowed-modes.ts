import { useMemo } from 'react'
import { useIsClient } from 'web/hooks/use-is-client'
import { usePersistentLocalState } from 'web/hooks/use-persistent-local-state'
import { getCookie } from 'web/lib/util/cookie'
import {
  allowedModesForRegion,
  defaultModeForRegion,
  type AllowedModes,
  type MoneyMode,
  REGION_COOKIE,
} from 'web/lib/compliance/jurisdiction'
import { isOnchainEnabled } from 'web/lib/onchain/addresses'

/**
 * The jurisdiction-aware money-mode state surfaced to the UI.
 *
 * SOFT COMPLIANCE AID — NOT LEGAL ADVICE. See lib/compliance/jurisdiction.ts.
 * This tells the UI which modes to OFFER and which to DEFAULT to; it never
 * changes the off-chain play-money experience, which stays available everywhere.
 */
export interface MoneyModeState extends AllowedModes {
  /** True once the client has read the region cookie + stored override. */
  ready: boolean
  /** The mode the user is actively viewing (default for region, or override). */
  mode: MoneyMode
  /** True when the user may choose between both modes (both are allowed). */
  canSwitch: boolean
  /** Switch modes (only honored when both are allowed). Persists locally. */
  setMode: (mode: MoneyMode) => void
  /** Clear any manual override and fall back to the region default. */
  resetMode: () => void
}

const OVERRIDE_KEY = 'predikt-money-mode-override-v1'

/**
 * Resolve the region from the cookie the edge middleware set (client only).
 * Returns null on the server or when no geo signal was available.
 */
function readRegionCookie(isClient: boolean): string | null {
  if (!isClient) return null
  const value = getCookie(REGION_COOKIE)
  return value ? value : null
}

/**
 * Central hook for the money-mode layer. Combines:
 *   - the real geo signal (region cookie set by middleware),
 *   - the operator's blocklist/allowlist policy (env), and
 *   - an optional user override (settings toggle, persisted locally).
 *
 * Guarantees:
 *   - Play money is ALWAYS allowed (the safe default everywhere).
 *   - On-chain is only ever offered when the deployment is configured
 *     (`isOnchainEnabled()`) AND the region policy permits it.
 *   - A stored override is honored ONLY while both modes are allowed; if the
 *     region later disallows on-chain, the effective mode snaps back to play.
 */
export function useAllowedModes(): MoneyModeState {
  const isClient = useIsClient()
  const [override, setOverride, overrideReady] =
    usePersistentLocalState<MoneyMode | null>(null, OVERRIDE_KEY)

  const region = readRegionCookie(isClient)

  return useMemo<MoneyModeState>(() => {
    const modes = allowedModesForRegion(region)
    // The on-chain path also requires the deployment to be configured at all.
    const onChain = modes.onChain && isOnchainEnabled()
    const canSwitch = modes.playMoney && onChain

    const regionDefault =
      defaultModeForRegion(region) === 'onchain' && onChain ? 'onchain' : 'play'

    // Honor a stored override only when both modes are actually available.
    const effective: MoneyMode =
      canSwitch && (override === 'play' || override === 'onchain')
        ? override
        : regionDefault

    return {
      playMoney: modes.playMoney,
      onChain,
      region: modes.region,
      ready: isClient && overrideReady,
      mode: effective,
      canSwitch,
      setMode: (m: MoneyMode) => setOverride(m),
      resetMode: () => setOverride(null),
    }
  }, [region, override, overrideReady, isClient, setOverride])
}
