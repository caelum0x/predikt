import { describe, expect, it } from 'vitest'
import {
  draftMarketRequestSchema,
  draftMarketSchema,
  estimateOddsRequestSchema,
  normalizeCloseTime,
  oddsEstimateSchema,
  resolutionSuggestionSchema,
} from '../src/ai/schema'

const NOW = Date.UTC(2026, 6, 14) // fixed clock for deterministic tests

const validDraft = {
  question: 'Will BTC close above $150k on Dec 31, 2026?',
  description: 'Based on the daily close on a major index.',
  outcomeType: 'BINARY',
  closeTime: NOW + 90 * 24 * 60 * 60 * 1000,
  category: 'Crypto',
  topicSlug: 'crypto',
  resolutionCriteria: 'Resolves YES if the CoinGecko daily close exceeds $150,000.',
}

describe('draftMarketRequestSchema', () => {
  it('requires at least one source', () => {
    expect(draftMarketRequestSchema.safeParse({}).success).toBe(false)
    expect(
      draftMarketRequestSchema.safeParse({ topic: 'US elections' }).success
    ).toBe(true)
  })

  it('rejects an invalid url and out-of-range count', () => {
    expect(
      draftMarketRequestSchema.safeParse({ url: 'not-a-url' }).success
    ).toBe(false)
    expect(
      draftMarketRequestSchema.safeParse({ topic: 'x'.repeat(10), count: 9 })
        .success
    ).toBe(false)
  })
})

describe('draftMarketSchema', () => {
  it('accepts a valid binary draft', () => {
    expect(draftMarketSchema.safeParse(validDraft).success).toBe(true)
  })

  it('rejects MULTIPLE_CHOICE with fewer than two distinct answers', () => {
    const draft = {
      ...validDraft,
      outcomeType: 'MULTIPLE_CHOICE',
      answers: ['Only one'],
    }
    expect(draftMarketSchema.safeParse(draft).success).toBe(false)
  })

  it('rejects numeric drafts without min < max', () => {
    const draft = {
      ...validDraft,
      outcomeType: 'PSEUDO_NUMERIC',
      min: 100,
      max: 100,
    }
    expect(draftMarketSchema.safeParse(draft).success).toBe(false)
  })

  it('rejects DATE drafts with dateMin >= dateMax', () => {
    const draft = {
      ...validDraft,
      outcomeType: 'DATE',
      dateMin: '2026-12-31',
      dateMax: '2026-01-01',
    }
    expect(draftMarketSchema.safeParse(draft).success).toBe(false)
  })
})

describe('normalizeCloseTime', () => {
  it('replaces past close times with a ~30 day fallback, immutably', () => {
    const parsed = draftMarketSchema.parse({ ...validDraft, closeTime: 0 })
    const normalized = normalizeCloseTime(parsed, NOW)
    expect(normalized.closeTime).toBe(NOW + 30 * 24 * 60 * 60 * 1000)
    expect(parsed.closeTime).toBe(0) // input untouched
  })

  it('clamps close times beyond the 5 year horizon', () => {
    const tenYears = NOW + 10 * 365 * 24 * 60 * 60 * 1000
    const parsed = draftMarketSchema.parse({
      ...validDraft,
      closeTime: tenYears,
    })
    const normalized = normalizeCloseTime(parsed, NOW)
    expect(normalized.closeTime).toBeLessThan(tenYears)
  })
})

describe('estimateOddsRequestSchema', () => {
  it('accepts a minimal valid request', () => {
    const result = estimateOddsRequestSchema.safeParse({
      question: 'Will the Fed cut rates before October 2026?',
    })
    expect(result.success).toBe(true)
  })

  it('rejects a malformed deadline', () => {
    const result = estimateOddsRequestSchema.safeParse({
      question: 'Will the Fed cut rates before October 2026?',
      deadline: 'October 2026',
    })
    expect(result.success).toBe(false)
  })
})

describe('oddsEstimateSchema', () => {
  const validEstimate = {
    probability: 0.62,
    confidence: 'medium',
    rationale: 'Base rate of cuts in easing cycles, adjusted for guidance.',
    baseRate: 'Fed cut within 6 months in 70% of comparable pauses.',
    keyDrivers: ['Inflation prints', 'Labor market'],
    updateTriggers: ['Next FOMC statement'],
    citations: [],
  }

  it('accepts a valid estimate', () => {
    expect(oddsEstimateSchema.safeParse(validEstimate).success).toBe(true)
  })

  it('rejects probabilities of exactly 0 or 1', () => {
    expect(
      oddsEstimateSchema.safeParse({ ...validEstimate, probability: 1 })
        .success
    ).toBe(false)
    expect(
      oddsEstimateSchema.safeParse({ ...validEstimate, probability: 0 })
        .success
    ).toBe(false)
  })

  it('requires at least one key driver', () => {
    expect(
      oddsEstimateSchema.safeParse({ ...validEstimate, keyDrivers: [] })
        .success
    ).toBe(false)
  })
})

describe('resolutionSuggestionSchema', () => {
  it('accepts a valid suggestion and defaults citations', () => {
    const result = resolutionSuggestionSchema.safeParse({
      verdict: 'YES',
      confidence: 0.9,
      rationale: 'The provided source confirms the outcome directly.',
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.citations).toEqual([])
  })

  it('rejects an unknown verdict', () => {
    const result = resolutionSuggestionSchema.safeParse({
      verdict: 'MAYBE',
      confidence: 0.5,
      rationale: 'Not a real verdict value.',
    })
    expect(result.success).toBe(false)
  })
})
