/**
 * Pure geo-region resolution — turns the raw edge/CDN geo signals into the
 * single normalized region string the whole money-mode layer consumes.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SOFT COMPLIANCE AID — NOT LEGAL ADVICE. See lib/compliance/jurisdiction.ts.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The edge middleware is the ONLY place the visitor's country is observed, and
 * it arrives on one of several host-specific channels (Vercel's parsed `geo`,
 * or a raw CDN header from Vercel/Cloudflare/a reverse proxy). Picking the right
 * channel — with a documented priority order and the same normalization the rest
 * of the compliance layer uses — is launch-critical routing logic, but it was
 * buried inside `middleware.ts` where the unit suite (roots: `lib/`) can never
 * reach it. Extracting it here makes it PURE and exercisable directly (no
 * `NextRequest`, no edge runtime), leaving the middleware a thin adapter that
 * just supplies the live request.
 */
import { normalizeRegion } from 'web/lib/compliance/jurisdiction'

/**
 * Raw geo-country request headers the edge/CDN may set, in priority order
 * (most trusted first). Checked only after the host runtime's parsed geo:
 *   - `x-vercel-ip-country` — Vercel's raw geo header.
 *   - `cf-ipcountry`        — Cloudflare's geo header.
 *   - `x-country`           — generic CDN / reverse-proxy override.
 */
export const GEO_COUNTRY_HEADERS = [
  'x-vercel-ip-country',
  'cf-ipcountry',
  'x-country',
] as const

/**
 * The minimal, read-only slice of the Fetch `Headers` API this module needs.
 * `NextRequest.headers` satisfies it, and tests can pass a trivial fake.
 */
export interface HeaderReader {
  get(name: string): string | null
}

/**
 * Resolve the visitor's region from the edge/CDN geo signals. Pure — the whole
 * reason this is testable in isolation.
 *
 * Priority order (first PRESENT source wins, then it is normalized once):
 *   1. `geoCountry` — the host runtime's parsed geo (e.g. Vercel `geo.country`).
 *   2. each header in `GEO_COUNTRY_HEADERS`, in order.
 *
 * A source is "present" when it is neither `null` nor `undefined`; a
 * present-but-invalid value (e.g. the "XX"/"T1" unknown-origin sentinels, or an
 * empty string) STOPS the search and resolves to `null` rather than falling
 * through — mirroring the original `??`-chained middleware behavior exactly.
 *
 * @param headers     Read-only header accessor (e.g. `request.headers`).
 * @param geoCountry  The host runtime's parsed country, or null/undefined.
 * @returns An uppercased ISO-3166 alpha-2 code, or `null` when unknown/invalid.
 */
export function resolveRegion(
  headers: HeaderReader,
  geoCountry?: string | null
): string | null {
  const candidates: (string | null | undefined)[] = [
    geoCountry,
    ...GEO_COUNTRY_HEADERS.map((name) => headers.get(name)),
  ]
  // First source that is actually present. `!= null` matches `??` chaining:
  // only a missing (null/undefined) source falls through; a present one stops.
  const raw = candidates.find((value) => value != null) ?? undefined
  return normalizeRegion(raw)
}
