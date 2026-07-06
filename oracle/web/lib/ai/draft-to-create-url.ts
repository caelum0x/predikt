// Turns an (edited) AI draft into the existing create-market handoff URL.
//
// This is the seam between "AI drafts" and "the app's real create flow": we do
// NOT call the create API from the AI code. Instead we prefill the existing
// new-contract panel via its established `/create?params=<json>` mechanism, so
// the human reviews everything and the app's own create path posts the market.

import type { NewQuestionParams } from 'web/components/new-contract/contract-types'
import type { DraftMarket } from 'web/lib/ai/schema'

function randomKey(): string {
  return Math.random().toString(36).slice(2, 8)
}

export function draftToCreateParams(draft: DraftMarket): NewQuestionParams {
  const params: NewQuestionParams = {
    q: draft.question,
    // The panel JSON.parses `description`, so we JSON-encode a plain string.
    description: JSON.stringify(draft.description ?? ''),
    closeTime: draft.closeTime,
    outcomeType: draft.outcomeType,
    visibility: 'public',
    // `rand` makes the panel treat this as a fresh prefill (not the persisted
    // local draft), matching how duplication works.
    rand: randomKey(),
  }

  if (draft.outcomeType === 'MULTIPLE_CHOICE' && draft.answers) {
    params.answers = draft.answers
    params.addAnswersMode = 'DISABLED'
    params.shouldAnswersSumToOne = true
  }

  if (draft.outcomeType === 'PSEUDO_NUMERIC') {
    params.min = draft.min
    params.max = draft.max
    params.initValue =
      typeof draft.min === 'number' && typeof draft.max === 'number'
        ? (draft.min + draft.max) / 2
        : undefined
  }

  if (draft.outcomeType === 'MULTI_NUMERIC') {
    // The create panel generates the bucket answers/midpoints from min/max/unit.
    params.min = draft.min
    params.max = draft.max
    params.unit = draft.unit
    params.shouldAnswersSumToOne = true
    params.addAnswersMode = 'DISABLED'
  }

  if (draft.outcomeType === 'DATE') {
    // DATE ranges travel as date strings; the panel generates the date buckets.
    params.dateMin = draft.dateMin
    params.dateMax = draft.dateMax
    params.shouldAnswersSumToOne = true
    params.addAnswersMode = 'DISABLED'
  }

  return params
}

export function draftToCreateUrl(draft: DraftMarket): string {
  const params = draftToCreateParams(draft)
  return '/create?params=' + encodeURIComponent(JSON.stringify(params))
}
