/**
 * Real behavior tests for the AI market-factory zod schemas. The model output is
 * never trusted raw — these assert that GOOD drafts parse, MALFORMED ones are
 * rejected, and closeTime normalization clamps into a sane future window.
 */
import {
  draftMarketRequestSchema,
  draftMarketResponseSchema,
  draftMarketSchema,
  normalizeCloseTime,
  resolutionSuggestionSchema,
  suggestResolutionRequestSchema,
  type DraftMarket,
} from './schema'

const NOW = 1_700_000_000_000 // fixed reference epoch-ms

function binaryDraft(overrides: Partial<DraftMarket> = {}): unknown {
  return {
    question: 'Will it rain in NYC tomorrow?',
    description: '',
    outcomeType: 'BINARY',
    closeTime: NOW + 7 * 24 * 60 * 60 * 1000,
    category: 'Weather',
    topicSlug: 'weather-nyc',
    resolutionCriteria: 'Resolves YES if measurable precipitation is recorded.',
    ...overrides,
  }
}

describe('draftMarketSchema: accepts good drafts', () => {
  it('parses a valid BINARY draft', () => {
    const parsed = draftMarketSchema.parse(binaryDraft())
    expect(parsed.outcomeType).toBe('BINARY')
    expect(parsed.description).toBe('') // default applied
  })

  it('parses a valid MULTIPLE_CHOICE draft with distinct answers', () => {
    const parsed = draftMarketSchema.parse(
      binaryDraft({
        outcomeType: 'MULTIPLE_CHOICE',
        answers: ['Democrat', 'Republican', 'Independent'],
      })
    )
    expect(parsed.answers).toHaveLength(3)
  })

  it('parses a valid PSEUDO_NUMERIC draft with min < max', () => {
    const parsed = draftMarketSchema.parse(
      binaryDraft({ outcomeType: 'PSEUDO_NUMERIC', min: 0, max: 100 })
    )
    expect(parsed.min).toBe(0)
    expect(parsed.max).toBe(100)
  })

  it('parses a valid MULTI_NUMERIC draft (range + unit)', () => {
    const parsed = draftMarketSchema.parse(
      binaryDraft({
        outcomeType: 'MULTI_NUMERIC',
        min: 1,
        max: 10,
        unit: 'seats',
      })
    )
    expect(parsed.unit).toBe('seats')
  })

  it('parses a valid DATE draft (dateMin < dateMax)', () => {
    const parsed = draftMarketSchema.parse(
      binaryDraft({
        outcomeType: 'DATE',
        dateMin: '2026-01-01',
        dateMax: '2026-12-31',
      })
    )
    expect(parsed.dateMin).toBe('2026-01-01')
  })

  it('trims whitespace on string fields', () => {
    const parsed = draftMarketSchema.parse(
      binaryDraft({ question: '   Will BTC top $100k this year?   ' })
    )
    expect(parsed.question).toBe('Will BTC top $100k this year?')
  })
})

describe('draftMarketSchema: rejects malformed drafts', () => {
  it('rejects a too-short question', () => {
    expect(draftMarketSchema.safeParse(binaryDraft({ question: 'short' }))
      .success).toBe(false)
  })

  it('rejects an unknown outcomeType', () => {
    expect(
      draftMarketSchema.safeParse(binaryDraft({ outcomeType: 'SCALAR' as never }))
        .success
    ).toBe(false)
  })

  it('rejects a non-finite closeTime', () => {
    expect(
      draftMarketSchema.safeParse(binaryDraft({ closeTime: Infinity as never }))
        .success
    ).toBe(false)
    expect(
      draftMarketSchema.safeParse(binaryDraft({ closeTime: NaN as never }))
        .success
    ).toBe(false)
  })

  it('rejects an invalid topicSlug (uppercase / spaces)', () => {
    expect(
      draftMarketSchema.safeParse(binaryDraft({ topicSlug: 'Not Valid' }))
        .success
    ).toBe(false)
  })

  it('rejects MULTIPLE_CHOICE with fewer than two distinct answers', () => {
    expect(
      draftMarketSchema.safeParse(
        binaryDraft({ outcomeType: 'MULTIPLE_CHOICE', answers: ['Only one'] })
      ).success
    ).toBe(false)
    // Duplicate answers (case-insensitive) also fail.
    expect(
      draftMarketSchema.safeParse(
        binaryDraft({
          outcomeType: 'MULTIPLE_CHOICE',
          answers: ['Yes', 'yes'],
        })
      ).success
    ).toBe(false)
  })

  it('rejects PSEUDO_NUMERIC / MULTI_NUMERIC with min >= max', () => {
    expect(
      draftMarketSchema.safeParse(
        binaryDraft({ outcomeType: 'PSEUDO_NUMERIC', min: 10, max: 10 })
      ).success
    ).toBe(false)
    expect(
      draftMarketSchema.safeParse(
        binaryDraft({ outcomeType: 'MULTI_NUMERIC', min: 5, max: 1, unit: 'x' })
      ).success
    ).toBe(false)
  })

  it('rejects MULTI_NUMERIC missing a unit', () => {
    expect(
      draftMarketSchema.safeParse(
        binaryDraft({ outcomeType: 'MULTI_NUMERIC', min: 1, max: 10 })
      ).success
    ).toBe(false)
  })

  it('rejects DATE with malformed or reversed dates', () => {
    expect(
      draftMarketSchema.safeParse(
        binaryDraft({
          outcomeType: 'DATE',
          dateMin: '01/01/2026',
          dateMax: '2026-12-31',
        })
      ).success
    ).toBe(false)
    expect(
      draftMarketSchema.safeParse(
        binaryDraft({
          outcomeType: 'DATE',
          dateMin: '2026-12-31',
          dateMax: '2026-01-01',
        })
      ).success
    ).toBe(false)
  })
})

describe('normalizeCloseTime: clamps into a sane future window (immutable)', () => {
  it('keeps a valid future closeTime unchanged', () => {
    const draft = draftMarketSchema.parse(
      binaryDraft({ closeTime: NOW + 7 * 24 * 60 * 60 * 1000 })
    )
    const out = normalizeCloseTime(draft, NOW)
    expect(out.closeTime).toBe(NOW + 7 * 24 * 60 * 60 * 1000)
    // Immutable: a new object is returned, input untouched.
    expect(out).not.toBe(draft)
    expect(draft.closeTime).toBe(NOW + 7 * 24 * 60 * 60 * 1000)
  })

  it('pushes a past/near closeTime to the 30-day fallback', () => {
    const draft = draftMarketSchema.parse(
      binaryDraft({ closeTime: NOW + 1000 }) // < 1h out
    )
    const out = normalizeCloseTime(draft, NOW)
    expect(out.closeTime).toBe(NOW + 30 * 24 * 60 * 60 * 1000)
  })

  it('clamps a far-future closeTime to the ~5-year horizon', () => {
    const tenYears = NOW + 10 * 365 * 24 * 60 * 60 * 1000
    const draft = draftMarketSchema.parse(binaryDraft({ closeTime: tenYears }))
    const out = normalizeCloseTime(draft, NOW)
    const fiveYears = NOW + 5 * 365 * 24 * 60 * 60 * 1000
    expect(out.closeTime).toBe(fiveYears)
  })
})

describe('draftMarketResponseSchema', () => {
  it('accepts 1..5 drafts', () => {
    expect(
      draftMarketResponseSchema.safeParse({ drafts: [binaryDraft()] }).success
    ).toBe(true)
  })

  it('rejects an empty drafts array', () => {
    expect(draftMarketResponseSchema.safeParse({ drafts: [] }).success).toBe(
      false
    )
  })
})

describe('draftMarketRequestSchema: at least one source required', () => {
  it('accepts a topic', () => {
    expect(draftMarketRequestSchema.safeParse({ topic: 'AI' }).success).toBe(
      true
    )
  })

  it('accepts a URL', () => {
    expect(
      draftMarketRequestSchema.safeParse({ url: 'https://example.com/news' })
        .success
    ).toBe(true)
  })

  it('rejects an empty body (no source)', () => {
    expect(draftMarketRequestSchema.safeParse({}).success).toBe(false)
  })

  it('rejects a malformed URL', () => {
    expect(
      draftMarketRequestSchema.safeParse({ url: 'not a url' }).success
    ).toBe(false)
  })
})

describe('resolution schemas', () => {
  it('accepts a well-formed resolution suggestion', () => {
    const parsed = resolutionSuggestionSchema.parse({
      verdict: 'YES',
      confidence: 0.9,
      rationale: 'Official results confirm the outcome clearly.',
    })
    expect(parsed.citations).toEqual([]) // default applied
  })

  it('rejects a confidence outside [0,1] or an unknown verdict', () => {
    expect(
      resolutionSuggestionSchema.safeParse({
        verdict: 'YES',
        confidence: 1.5,
        rationale: 'Long enough rationale text here.',
      }).success
    ).toBe(false)
    expect(
      resolutionSuggestionSchema.safeParse({
        verdict: 'MAYBE',
        confidence: 0.5,
        rationale: 'Long enough rationale text here.',
      }).success
    ).toBe(false)
  })

  it('defaults suggestResolution outcomeType to BINARY', () => {
    const parsed = suggestResolutionRequestSchema.parse({
      question: 'Did X happen?',
    })
    expect(parsed.outcomeType).toBe('BINARY')
  })
})
