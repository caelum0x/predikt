import { CreateableOutcomeType, add_answers_mode } from 'common/contract'

// Type definitions for URL params and contract creation
export type NewQuestionParams = {
  groupIds?: string[]
  groupSlugs?: string[]
  q: string
  description: string
  closeTime: number
  outcomeType?: CreateableOutcomeType
  visibility: string
  // Params for PSEUDO_NUMERIC / MULTI_NUMERIC outcomeType
  min?: number
  max?: number
  // Params for DATE outcomeType (range endpoints as date strings, e.g. YYYY-MM-DD)
  dateMin?: string
  dateMax?: string
  isLogScale?: boolean
  initValue?: number
  answers?: string[]
  addAnswersMode?: add_answers_mode
  shouldAnswersSumToOne?: boolean
  precision?: number
  sportsStartTimestamp?: string
  sportsEventId?: string
  sportsLeague?: string
  unit?: string
  midpoints?: number[]
  rand?: string
  overrideKey?: string
}
