// Raw SQLite row shapes for the market engine and their mappers to the public
// API types. Kept separate from MarketService so the service file stays
// focused on business logic.

import { getProb, round6, type Pool } from './cpmm'
import {
  leadingAnswer,
  rowToPool,
  toAnswerView,
  type AnswerRow,
} from './answers'
import type {
  Account,
  Market,
  MarketStatus,
  OutcomeType,
  Position,
} from './service'

export type MarketRow = {
  id: string
  creator_id: string
  question: string
  description: string
  criteria: string
  category: string
  close_time: number
  status: MarketStatus
  outcome: string | null
  outcome_type: OutcomeType
  pool_yes: number
  pool_no: number
  pool_p: number
  pool_k: number
  subsidy: number
  volume: number
  created_at: number
  resolved_at: number | null
}

export type AccountRow = {
  id: string
  name: string
  balance: number
  created_at: number
}

export type PositionRow = {
  account_id: string
  market_id: string
  answer_id: string
  yes_shares: number
  no_shares: number
  invested: number
}

export function rowPool(row: MarketRow): Pool {
  return { yes: row.pool_yes, no: row.pool_no, p: row.pool_p, k: row.pool_k }
}

export function toAccount(row: AccountRow): Account {
  return {
    id: row.id,
    name: row.name,
    balance: round6(row.balance),
    createdAt: row.created_at,
  }
}

export function toMarket(row: MarketRow, answerRows: AnswerRow[] | null): Market {
  const base = {
    id: row.id,
    creatorId: row.creator_id,
    question: row.question,
    description: row.description,
    criteria: row.criteria,
    category: row.category,
    closeTime: row.close_time,
    status: row.status,
    outcomeType: row.outcome_type,
    outcome: row.outcome,
    subsidy: row.subsidy,
    volume: round6(row.volume),
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  }
  if (row.outcome_type === 'MULTI' && answerRows) {
    const lead = leadingAnswer(answerRows)
    return {
      ...base,
      probability: lead ? round6(getProb(rowToPool(lead))) : 0,
      answers: answerRows.map(toAnswerView),
    }
  }
  return { ...base, probability: round6(getProb(rowPool(row))) }
}

export function toPosition(row: PositionRow): Position {
  return {
    accountId: row.account_id,
    marketId: row.market_id,
    answerId: row.answer_id === '' ? null : row.answer_id,
    yesShares: round6(row.yes_shares),
    noShares: round6(row.no_shares),
    invested: round6(row.invested),
  }
}
