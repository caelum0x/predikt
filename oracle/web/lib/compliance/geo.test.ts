/**
 * Real behavior tests for the pure geo-region resolver.
 *
 * This module is PURE (see its own doc header): it reads nothing but the header
 * accessor and optional geo value handed to it. So we exercise the real
 * production function directly — no fakes beyond a trivial in-memory header map
 * that stands in for the Fetch `Headers` API the middleware passes at runtime.
 *
 * Coverage intent: the documented priority order (parsed geo → the three CDN
 * headers), the "first PRESENT source wins / present-but-invalid stops" rule,
 * and the normalization + sentinel handling delegated to `normalizeRegion`,
 * since this is the launch-gating signal every other compliance path consumes.
 */
import { GEO_COUNTRY_HEADERS, resolveRegion, type HeaderReader } from './geo'

/**
 * A trivial, case-insensitive header bag matching the Fetch `Headers.get`
 * contract (absent header → null). Real `Headers` lower-cases keys, so we do too.
 */
function headers(entries: Record<string, string> = {}): HeaderReader {
  const map = new Map<string, string>()
  for (const [key, value] of Object.entries(entries)) {
    map.set(key.toLowerCase(), value)
  }
  return { get: (name) => map.get(name.toLowerCase()) ?? null }
}

describe('GEO_COUNTRY_HEADERS', () => {
  it('is the documented priority order of raw CDN geo headers', () => {
    expect(GEO_COUNTRY_HEADERS).toEqual([
      'x-vercel-ip-country',
      'cf-ipcountry',
      'x-country',
    ])
  })
})

describe('resolveRegion — parsed geo (highest priority)', () => {
  it('uses the host runtime geo value, normalized, over any header', () => {
    const region = resolveRegion(headers({ 'x-vercel-ip-country': 'GB' }), 'us')
    expect(region).toBe('US')
  })

  it('falls through to headers when the parsed geo is null or undefined', () => {
    expect(resolveRegion(headers({ 'cf-ipcountry': 'fr' }), null)).toBe('FR')
    expect(resolveRegion(headers({ 'cf-ipcountry': 'fr' }), undefined)).toBe(
      'FR'
    )
    // Omitted entirely (optional arg) behaves like undefined.
    expect(resolveRegion(headers({ 'cf-ipcountry': 'fr' }))).toBe('FR')
  })

  it('stops at a present-but-invalid parsed geo (does NOT fall through)', () => {
    // "XX" is a present value, so it wins the race and then normalizes to null —
    // the lower, valid header is intentionally never consulted.
    expect(resolveRegion(headers({ 'x-country': 'FR' }), 'XX')).toBeNull()
    // An empty string is also "present" under `??`/`!= null` semantics.
    expect(resolveRegion(headers({ 'x-country': 'FR' }), '')).toBeNull()
  })
})

describe('resolveRegion — header priority order', () => {
  it('prefers x-vercel-ip-country over cf-ipcountry and x-country', () => {
    const region = resolveRegion(
      headers({
        'x-vercel-ip-country': 'us',
        'cf-ipcountry': 'gb',
        'x-country': 'fr',
      })
    )
    expect(region).toBe('US')
  })

  it('prefers cf-ipcountry over x-country when Vercel geo is absent', () => {
    const region = resolveRegion(
      headers({ 'cf-ipcountry': 'gb', 'x-country': 'fr' })
    )
    expect(region).toBe('GB')
  })

  it('uses x-country as the last resort', () => {
    expect(resolveRegion(headers({ 'x-country': 'de' }))).toBe('DE')
  })

  it('stops at the first present header even if invalid', () => {
    // Vercel header present but a sentinel → resolves null without trying cf.
    expect(
      resolveRegion(
        headers({ 'x-vercel-ip-country': 'T1', 'cf-ipcountry': 'FR' })
      )
    ).toBeNull()
  })
})

describe('resolveRegion — no signal', () => {
  it('returns null when no geo value and no headers are present', () => {
    expect(resolveRegion(headers())).toBeNull()
    expect(resolveRegion(headers(), null)).toBeNull()
  })

  it('ignores unrelated headers', () => {
    expect(
      resolveRegion(headers({ 'user-agent': 'jest', accept: '*/*' }))
    ).toBeNull()
  })
})
