/**
 * Real behavior tests for the jurisdiction-aware money-mode signal.
 *
 * This module is PURE (see its own doc header): nothing reads the network,
 * `document`, or global process state beyond an explicitly-passed config. So we
 * exercise the real production functions directly — no fakes — and only touch
 * `process.env` for the two env-derived helpers, always restoring it after.
 *
 * Coverage intent: every exported function and every documented branch of the
 * allowlist / blocklist / unknown-region rules, since this compliance signal is
 * a launch-gating differentiator and must not silently regress.
 */
import {
  REGION_COOKIE,
  REGION_HEADER,
  normalizeRegion,
  parseRegionList,
  getJurisdictionConfig,
  isOnchainAllowedForRegion,
  allowedModesForRegion,
  defaultModeForRegion,
  type JurisdictionConfig,
} from './jurisdiction'

/** Blocklist-mode policy: on-chain allowed everywhere except the listed codes. */
function blocklist(...regions: string[]): JurisdictionConfig {
  return { blockedRegions: regions, allowedRegions: [] }
}

/** Allowlist-mode policy: on-chain allowed ONLY in the listed codes. */
function allowlist(...regions: string[]): JurisdictionConfig {
  return { blockedRegions: [], allowedRegions: regions }
}

describe('exported constants', () => {
  it('cookie and header names are the stable contract with the middleware', () => {
    expect(REGION_COOKIE).toBe('predikt-region')
    expect(REGION_HEADER).toBe('x-predikt-region')
  })
})

describe('normalizeRegion', () => {
  it('uppercases and trims a valid two-letter code', () => {
    expect(normalizeRegion(' us ')).toBe('US')
    expect(normalizeRegion('gb')).toBe('GB')
    expect(normalizeRegion('Fr')).toBe('FR')
  })

  it('returns null for empty / nullish input', () => {
    expect(normalizeRegion(null)).toBeNull()
    expect(normalizeRegion(undefined)).toBeNull()
    expect(normalizeRegion('')).toBeNull()
    expect(normalizeRegion('   ')).toBeNull()
  })

  it('rejects anything that is not exactly two ASCII letters', () => {
    expect(normalizeRegion('U')).toBeNull()
    expect(normalizeRegion('USA')).toBeNull()
    expect(normalizeRegion('U1')).toBeNull()
    expect(normalizeRegion('12')).toBeNull()
    expect(normalizeRegion('U S')).toBeNull()
  })

  it('rejects the CDN "unknown origin" sentinels XX and T1', () => {
    expect(normalizeRegion('XX')).toBeNull()
    expect(normalizeRegion('xx')).toBeNull()
    expect(normalizeRegion('T1')).toBeNull()
    expect(normalizeRegion('t1')).toBeNull()
  })
})

describe('parseRegionList', () => {
  it('returns an empty list for empty / nullish input', () => {
    expect(parseRegionList(null)).toEqual([])
    expect(parseRegionList(undefined)).toEqual([])
    expect(parseRegionList('')).toEqual([])
  })

  it('splits on commas, spaces, and semicolons and normalizes each code', () => {
    expect(parseRegionList('us, gb; fr de')).toEqual(['US', 'GB', 'FR', 'DE'])
  })

  it('drops invalid entries and de-duplicates (preserving first-seen order)', () => {
    expect(parseRegionList('US, usa, us, XX, gb, GB, T1, 7')).toEqual([
      'US',
      'GB',
    ])
  })
})

describe('getJurisdictionConfig (env-derived)', () => {
  const saved = {
    blocked: process.env.NEXT_PUBLIC_ONCHAIN_BLOCKED_REGIONS,
    allowed: process.env.NEXT_PUBLIC_ONCHAIN_ALLOWED_REGIONS,
  }

  afterEach(() => {
    if (saved.blocked === undefined) {
      delete process.env.NEXT_PUBLIC_ONCHAIN_BLOCKED_REGIONS
    } else {
      process.env.NEXT_PUBLIC_ONCHAIN_BLOCKED_REGIONS = saved.blocked
    }
    if (saved.allowed === undefined) {
      delete process.env.NEXT_PUBLIC_ONCHAIN_ALLOWED_REGIONS
    } else {
      process.env.NEXT_PUBLIC_ONCHAIN_ALLOWED_REGIONS = saved.allowed
    }
  })

  it('parses both env lists into normalized policy arrays', () => {
    process.env.NEXT_PUBLIC_ONCHAIN_BLOCKED_REGIONS = 'us, gb'
    process.env.NEXT_PUBLIC_ONCHAIN_ALLOWED_REGIONS = 'fr;de'
    const config = getJurisdictionConfig()
    expect(config.blockedRegions).toEqual(['US', 'GB'])
    expect(config.allowedRegions).toEqual(['FR', 'DE'])
  })

  it('defaults both lists to empty when the env vars are unset', () => {
    delete process.env.NEXT_PUBLIC_ONCHAIN_BLOCKED_REGIONS
    delete process.env.NEXT_PUBLIC_ONCHAIN_ALLOWED_REGIONS
    const config = getJurisdictionConfig()
    expect(config.blockedRegions).toEqual([])
    expect(config.allowedRegions).toEqual([])
  })
})

describe('isOnchainAllowedForRegion — blocklist mode (default-open)', () => {
  it('allows a region that is not on the blocklist', () => {
    expect(isOnchainAllowedForRegion('FR', blocklist('US'))).toBe(true)
  })

  it('blocks a region that is on the blocklist (case-insensitively)', () => {
    expect(isOnchainAllowedForRegion('us', blocklist('US'))).toBe(false)
    expect(isOnchainAllowedForRegion('US', blocklist('US'))).toBe(false)
  })

  it('allows an unknown / missing region (default-open)', () => {
    expect(isOnchainAllowedForRegion(null, blocklist('US'))).toBe(true)
    expect(isOnchainAllowedForRegion('XX', blocklist('US'))).toBe(true)
  })

  it('allows everywhere when the blocklist is empty', () => {
    expect(isOnchainAllowedForRegion('US', blocklist())).toBe(true)
  })
})

describe('isOnchainAllowedForRegion — allowlist mode (strict)', () => {
  it('takes precedence over the blocklist when non-empty', () => {
    const config: JurisdictionConfig = {
      blockedRegions: ['FR'],
      allowedRegions: ['FR'],
    }
    // Allowlist wins: FR is on the allowlist, so it is allowed despite also
    // appearing on the (ignored) blocklist.
    expect(isOnchainAllowedForRegion('FR', config)).toBe(true)
  })

  it('allows ONLY regions on the allowlist (case-insensitively)', () => {
    expect(isOnchainAllowedForRegion('fr', allowlist('FR'))).toBe(true)
    expect(isOnchainAllowedForRegion('US', allowlist('FR'))).toBe(false)
  })

  it('denies an unknown / missing region (allowlists are strict)', () => {
    expect(isOnchainAllowedForRegion(null, allowlist('FR'))).toBe(false)
    expect(isOnchainAllowedForRegion('XX', allowlist('FR'))).toBe(false)
  })
})

describe('allowedModesForRegion', () => {
  it('always permits play money, whatever the region or policy', () => {
    expect(allowedModesForRegion('US', blocklist('US')).playMoney).toBe(true)
    expect(allowedModesForRegion(null, allowlist('FR')).playMoney).toBe(true)
  })

  it('mirrors the on-chain decision and echoes the normalized region', () => {
    expect(allowedModesForRegion('gb', blocklist('US'))).toEqual({
      playMoney: true,
      onChain: true,
      region: 'GB',
    })
    expect(allowedModesForRegion('us', blocklist('US'))).toEqual({
      playMoney: true,
      onChain: false,
      region: 'US',
    })
  })

  it('reports a null region for an unrecognized geo signal', () => {
    expect(allowedModesForRegion('XX', blocklist('US')).region).toBeNull()
  })

  it('falls back to the env-derived config when none is passed', () => {
    const saved = process.env.NEXT_PUBLIC_ONCHAIN_BLOCKED_REGIONS
    delete process.env.NEXT_PUBLIC_ONCHAIN_BLOCKED_REGIONS
    try {
      // Empty env policy => on-chain open everywhere.
      expect(allowedModesForRegion('US')).toEqual({
        playMoney: true,
        onChain: true,
        region: 'US',
      })
    } finally {
      if (saved === undefined) {
        delete process.env.NEXT_PUBLIC_ONCHAIN_BLOCKED_REGIONS
      } else {
        process.env.NEXT_PUBLIC_ONCHAIN_BLOCKED_REGIONS = saved
      }
    }
  })
})

describe('defaultModeForRegion', () => {
  it('defaults to on-chain where it is allowed', () => {
    expect(defaultModeForRegion('FR', blocklist('US'))).toBe('onchain')
    expect(defaultModeForRegion(null, blocklist('US'))).toBe('onchain')
  })

  it('falls back to play money where on-chain is disallowed', () => {
    expect(defaultModeForRegion('US', blocklist('US'))).toBe('play')
    expect(defaultModeForRegion(null, allowlist('FR'))).toBe('play')
  })

  it('falls back to the env-derived config when none is passed', () => {
    const saved = process.env.NEXT_PUBLIC_ONCHAIN_ALLOWED_REGIONS
    process.env.NEXT_PUBLIC_ONCHAIN_ALLOWED_REGIONS = 'FR'
    try {
      // Strict allowlist of FR: only FR defaults to on-chain, US falls back.
      expect(defaultModeForRegion('FR')).toBe('onchain')
      expect(defaultModeForRegion('US')).toBe('play')
    } finally {
      if (saved === undefined) {
        delete process.env.NEXT_PUBLIC_ONCHAIN_ALLOWED_REGIONS
      } else {
        process.env.NEXT_PUBLIC_ONCHAIN_ALLOWED_REGIONS = saved
      }
    }
  })
})
