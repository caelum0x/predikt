/**
 * Jurisdiction-aware money-mode signal.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS IS NOT LEGAL ADVICE.
 *
 * This module is a SOFT, CONFIGURABLE COMPLIANCE AID — a convenience that
 * defaults users to the money mode most likely to be appropriate for their
 * region (free play money where crypto/betting is restricted, on-chain crypto
 * where it is permitted). It does NOT determine legality, does NOT constitute
 * legal advice, and is NOT a substitute for counsel. Geo signals from a CDN can
 * be wrong, spoofed (VPN/proxy), or missing. OPERATORS MUST CONFIGURE THE
 * BLOCKLIST/ALLOWLIST PER THEIR OWN LEGAL COUNSEL and remain responsible for
 * compliance in every market they serve.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Design:
 *   - PURE + TESTABLE. Nothing here reads the network, `document`, or global
 *     process state beyond an explicitly-passed config. The env-derived config
 *     is resolved once in `getJurisdictionConfig()` (which callers may override
 *     in tests by passing their own `JurisdictionConfig`).
 *   - The real geo signal is produced by the edge middleware (Vercel/CDN geo
 *     header) and surfaced to the app as a `region` string (an ISO-3166 country
 *     code, uppercased). This module only INTERPRETS that region.
 *   - DEFAULTS: play money is allowed EVERYWHERE (the safe default). On-chain is
 *     allowed everywhere too, UNLESS the region is on the operator's blocklist
 *     (or an allowlist is set and the region is not on it).
 */

/** The two money modes a market can be traded in. */
export type MoneyMode = 'play' | 'onchain'

/** A resolved allowed-modes signal for a region. */
export interface AllowedModes {
  /** Free play-money trading is permitted. Always true (the safe default). */
  playMoney: boolean
  /** On-chain crypto (USDC) trading is permitted for this region. */
  onChain: boolean
  /**
   * The region the signal was computed for: an uppercased ISO-3166 alpha-2
   * country code (e.g. "US", "GB"), or `null` when no geo signal was available.
   */
  region: string | null
}

/**
 * Operator-supplied policy. Regions are matched case-insensitively against the
 * uppercased country code. Exactly one list is meaningful at a time:
 *   - `blockedRegions` (default mode): on-chain allowed everywhere EXCEPT these.
 *   - `allowedRegions` (allowlist mode): on-chain allowed ONLY in these; when
 *     set and non-empty it takes precedence and the blocklist is ignored.
 */
export interface JurisdictionConfig {
  /** Country codes where the on-chain path is disabled. */
  blockedRegions: readonly string[]
  /**
   * If non-empty, on-chain is allowed ONLY in these country codes (strict
   * allowlist). An unknown/missing region is treated as NOT allowed on-chain.
   */
  allowedRegions: readonly string[]
}

/** Name of the cookie the middleware sets so the client can read the region. */
export const REGION_COOKIE = 'predikt-region'

/** Name of the request/response header the middleware sets with the region. */
export const REGION_HEADER = 'x-predikt-region'

/**
 * Normalize a raw geo value into an uppercased ISO-3166 alpha-2 code, or null.
 * Rejects anything that isn't two ASCII letters (CDNs sometimes emit "XX", "T1",
 * or an empty string for unknown/Tor origins).
 */
export function normalizeRegion(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(trimmed)) return null
  if (trimmed === 'XX' || trimmed === 'T1') return null
  return trimmed
}

/**
 * Parse a comma/space/semicolon-separated list of country codes (from an env
 * var) into a normalized, de-duplicated array of uppercased codes. Invalid
 * entries are dropped.
 */
export function parseRegionList(raw: string | null | undefined): string[] {
  if (!raw) return []
  const seen = new Set<string>()
  for (const token of raw.split(/[\s,;]+/)) {
    const code = normalizeRegion(token)
    if (code) seen.add(code)
  }
  return Array.from(seen)
}

/**
 * Resolve the operator's jurisdiction policy from PUBLIC env vars. All values
 * are `NEXT_PUBLIC_*` so the same policy is available on the server (SSR) and in
 * the browser — none of this is secret.
 *
 *   NEXT_PUBLIC_ONCHAIN_BLOCKED_REGIONS  — CSV of country codes to block on-chain
 *   NEXT_PUBLIC_ONCHAIN_ALLOWED_REGIONS  — CSV; when set, on-chain is allowed
 *                                          ONLY in these (strict allowlist)
 *
 * Direct property access lets Next.js statically inline the values.
 */
export function getJurisdictionConfig(): JurisdictionConfig {
  return {
    blockedRegions: parseRegionList(
      process.env.NEXT_PUBLIC_ONCHAIN_BLOCKED_REGIONS
    ),
    allowedRegions: parseRegionList(
      process.env.NEXT_PUBLIC_ONCHAIN_ALLOWED_REGIONS
    ),
  }
}

/**
 * Whether the on-chain path is allowed for a region under a given policy.
 * Pure — the whole reason this is testable.
 *
 * Rules (in order):
 *   1. Allowlist mode (allowedRegions non-empty): allowed IFF region is listed.
 *      An unknown region (null) is NOT allowed on-chain — allowlists are strict.
 *   2. Blocklist mode: allowed everywhere EXCEPT listed regions. An unknown
 *      region (null) IS allowed on-chain (default-open), matching the app's
 *      "on-chain allowed unless blocked" default.
 */
export function isOnchainAllowedForRegion(
  region: string | null,
  config: JurisdictionConfig
): boolean {
  const normalized = normalizeRegion(region)

  if (config.allowedRegions.length > 0) {
    if (!normalized) return false
    return config.allowedRegions.includes(normalized)
  }

  if (!normalized) return true
  return !config.blockedRegions.includes(normalized)
}

/**
 * Compute the allowed money modes for a region under a policy. Play money is
 * ALWAYS allowed (the safe default that works everywhere); on-chain follows
 * `isOnchainAllowedForRegion`.
 */
export function allowedModesForRegion(
  region: string | null,
  config: JurisdictionConfig = getJurisdictionConfig()
): AllowedModes {
  return {
    playMoney: true,
    onChain: isOnchainAllowedForRegion(region, config),
    region: normalizeRegion(region),
  }
}

/**
 * The mode a user should DEFAULT to for a region: on-chain when allowed,
 * otherwise play money (the always-safe fallback).
 */
export function defaultModeForRegion(
  region: string | null,
  config: JurisdictionConfig = getJurisdictionConfig()
): MoneyMode {
  return isOnchainAllowedForRegion(region, config) ? 'onchain' : 'play'
}
