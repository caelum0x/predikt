/**
 * Pure money-mode resolution — the launch-gating decision that picks which
 * trading path (free play money vs on-chain crypto) a visitor is offered and
 * defaulted to.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SOFT COMPLIANCE AID — NOT LEGAL ADVICE. See lib/compliance/jurisdiction.ts.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The `useAllowedModes` hook combines three inputs — the geo signal (region),
 * the operator's env policy, and whether the deployment even configured an
 * on-chain path — plus an optional persisted user override, into a single UI
 * state. That combination logic is PURE and launch-critical, so it lives here,
 * decoupled from React, where it can be exercised directly (no DOM, no hooks).
 *
 * The hook stays a thin adapter: it reads the cookie + local override and the
 * `isOnchainEnabled()` deployment flag, then delegates the decision to
 * `resolveMoneyMode`.
 */
import {
  allowedModesForRegion,
  defaultModeForRegion,
  getJurisdictionConfig,
  type AllowedModes,
  type JurisdictionConfig,
  type MoneyMode,
} from 'web/lib/compliance/jurisdiction'

/**
 * The resolved money-mode decision for a visitor. Extends the region-level
 * `AllowedModes` signal with the two derived UI facts: whether the user may
 * switch between modes, and which mode is effectively active.
 */
export interface MoneyModeResolution extends AllowedModes {
  /** True when BOTH modes are available, so a toggle should be offered. */
  canSwitch: boolean
  /** The effective mode: a valid override when switchable, else the default. */
  mode: MoneyMode
}

/**
 * Resolve the money-mode UI state from its raw inputs. Pure — the whole reason
 * this is testable in isolation.
 *
 * Rules (in order):
 *   1. Play money is ALWAYS allowed (the safe default everywhere).
 *   2. On-chain is offered only when the region policy permits it AND the
 *      deployment actually configured an on-chain path (`onchainConfigured`).
 *   3. The user may switch only when both modes are available (`canSwitch`).
 *   4. A stored `override` is honored ONLY while switchable; otherwise the mode
 *      snaps to the region default (which is on-chain only where it is offered).
 *
 * @param region             Uppercased ISO-3166 code, or null when unknown.
 * @param onchainConfigured  Whether this deployment wired an on-chain path.
 * @param override           A persisted user choice, or null for none.
 * @param config             Operator policy; defaults to the env-derived one.
 */
export function resolveMoneyMode(
  region: string | null,
  onchainConfigured: boolean,
  override: MoneyMode | null,
  config: JurisdictionConfig = getJurisdictionConfig()
): MoneyModeResolution {
  const modes = allowedModesForRegion(region, config)
  // The on-chain path also requires the deployment to be configured at all.
  const onChain = modes.onChain && onchainConfigured
  const canSwitch = modes.playMoney && onChain

  const regionDefault: MoneyMode =
    defaultModeForRegion(region, config) === 'onchain' && onChain
      ? 'onchain'
      : 'play'

  // Honor a stored override only when both modes are actually available.
  const mode: MoneyMode =
    canSwitch && (override === 'play' || override === 'onchain')
      ? override
      : regionDefault

  return {
    playMoney: modes.playMoney,
    onChain,
    region: modes.region,
    canSwitch,
    mode,
  }
}
