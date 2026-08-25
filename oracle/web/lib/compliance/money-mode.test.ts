/**
 * Real behavior tests for the pure money-mode resolution.
 *
 * `resolveMoneyMode` is the launch-gating decision that combines the geo signal,
 * the operator policy, the deployment's on-chain flag, and a user override into
 * the money-mode UI state. It is PURE, so we exercise the real function directly
 * — no React, no DOM, no fakes — and pass the policy explicitly.
 *
 * Coverage intent: every documented branch of the offered/switchable/default/
 * override rules, since a regression here silently mis-routes users between the
 * play-money and on-chain trading paths.
 */
import { resolveMoneyMode } from './money-mode'
import type { JurisdictionConfig } from './jurisdiction'

/** Blocklist-mode policy: on-chain allowed everywhere except the listed codes. */
function blocklist(...regions: string[]): JurisdictionConfig {
  return { blockedRegions: regions, allowedRegions: [] }
}

/** Allowlist-mode policy: on-chain allowed ONLY in the listed codes. */
function allowlist(...regions: string[]): JurisdictionConfig {
  return { blockedRegions: [], allowedRegions: regions }
}

describe('resolveMoneyMode — play money is the universal floor', () => {
  it('always offers play money, whatever the inputs', () => {
    expect(resolveMoneyMode('US', false, null, blocklist('US')).playMoney).toBe(
      true
    )
    expect(resolveMoneyMode(null, true, null, allowlist('FR')).playMoney).toBe(
      true
    )
  })

  it('echoes the normalized region and nulls an unrecognized geo signal', () => {
    expect(resolveMoneyMode('gb', true, null, blocklist('US')).region).toBe('GB')
    expect(resolveMoneyMode('XX', true, null, blocklist('US')).region).toBeNull()
  })
})

describe('resolveMoneyMode — on-chain requires BOTH policy and deployment', () => {
  it('offers on-chain when the region permits it and the deployment is configured', () => {
    const r = resolveMoneyMode('FR', true, null, blocklist('US'))
    expect(r.onChain).toBe(true)
    expect(r.canSwitch).toBe(true)
    expect(r.mode).toBe('onchain')
  })

  it('withholds on-chain when the deployment is NOT configured, even where allowed', () => {
    const r = resolveMoneyMode('FR', false, null, blocklist('US'))
    expect(r.onChain).toBe(false)
    expect(r.canSwitch).toBe(false)
    expect(r.mode).toBe('play')
  })

  it('withholds on-chain when the region blocks it, even if configured', () => {
    const r = resolveMoneyMode('US', true, null, blocklist('US'))
    expect(r.onChain).toBe(false)
    expect(r.canSwitch).toBe(false)
    expect(r.mode).toBe('play')
  })

  it('withholds on-chain outside a strict allowlist, even if configured', () => {
    const r = resolveMoneyMode('US', true, null, allowlist('FR'))
    expect(r.onChain).toBe(false)
    expect(r.canSwitch).toBe(false)
    expect(r.mode).toBe('play')
  })
})

describe('resolveMoneyMode — region default (no override)', () => {
  it('defaults to on-chain where it is offered', () => {
    expect(resolveMoneyMode('FR', true, null, blocklist('US')).mode).toBe(
      'onchain'
    )
    expect(resolveMoneyMode(null, true, null, blocklist('US')).mode).toBe(
      'onchain'
    )
  })

  it('defaults to play where on-chain is not offered', () => {
    expect(resolveMoneyMode('US', true, null, blocklist('US')).mode).toBe('play')
    expect(resolveMoneyMode(null, true, null, allowlist('FR')).mode).toBe('play')
  })
})

describe('resolveMoneyMode — user override', () => {
  it('honors a valid override only while both modes are switchable', () => {
    // Switchable region: an explicit "play" override sticks despite the
    // on-chain default.
    expect(resolveMoneyMode('FR', true, 'play', blocklist('US')).mode).toBe(
      'play'
    )
    // And an "onchain" override is honored where switchable.
    expect(resolveMoneyMode('FR', true, 'onchain', blocklist('US')).mode).toBe(
      'onchain'
    )
  })

  it('ignores an override when not switchable (snaps back to the default)', () => {
    // On-chain blocked here, so a stale "onchain" override must not leak.
    const r = resolveMoneyMode('US', true, 'onchain', blocklist('US'))
    expect(r.canSwitch).toBe(false)
    expect(r.mode).toBe('play')
  })

  it('ignores a null / malformed override and uses the region default', () => {
    expect(resolveMoneyMode('FR', true, null, blocklist('US')).mode).toBe(
      'onchain'
    )
  })
})

describe('resolveMoneyMode — env-derived default policy', () => {
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

  it('falls back to the env policy when no config is passed', () => {
    process.env.NEXT_PUBLIC_ONCHAIN_BLOCKED_REGIONS = 'US'
    delete process.env.NEXT_PUBLIC_ONCHAIN_ALLOWED_REGIONS
    // US is blocked by env => on-chain withheld even though configured.
    expect(resolveMoneyMode('US', true, null).onChain).toBe(false)
    // FR is not blocked => on-chain offered and defaulted.
    expect(resolveMoneyMode('FR', true, null).mode).toBe('onchain')
  })
})
