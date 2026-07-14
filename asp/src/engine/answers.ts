// Answer pools for MULTI (multiple-choice) markets. Each answer is its own
// independent binary CPMM ("will this answer win?"), like Polymarket's
// independent outcome markets. Pure row helpers + validation live here;
// MarketService orchestrates them inside its transactions.

import type { Db } from './store'
import { getProb, round6, type Pool } from './cpmm'
import { newId } from './ids'

export const MIN_ANSWERS = 2
export const MAX_ANSWERS = 12
export const MAX_ANSWER_LEN = 120

export type AnswerRow = {
  id: string
  market_id: string
  ord: number
  text: string
  pool_yes: number
  pool_no: number
  pool_p: number
  pool_k: number
  volume: number
}

// The public shape embedded in market payloads.
export type AnswerView = {
  id: string
  text: string
  probability: number
  volume: number
}

export class AnswerValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AnswerValidationError'
  }
}

/**
 * Validates and normalizes the answer texts of a new MULTI market: trims each
 * entry, requires 2-12 non-empty, distinct answers. Returns a NEW array.
 */
export function normalizeAnswerTexts(answers: readonly string[]): string[] {
  const trimmed = answers.map((text) => text.trim())
  if (trimmed.length < MIN_ANSWERS || trimmed.length > MAX_ANSWERS) {
    throw new AnswerValidationError(
      `MULTI markets need ${MIN_ANSWERS}-${MAX_ANSWERS} answers.`
    )
  }
  for (const text of trimmed) {
    if (text.length === 0 || text.length > MAX_ANSWER_LEN) {
      throw new AnswerValidationError(
        `Each answer must be 1-${MAX_ANSWER_LEN} characters.`
      )
    }
  }
  const seen = new Set(trimmed.map((text) => text.toLowerCase()))
  if (seen.size !== trimmed.length) {
    throw new AnswerValidationError('Answers must be distinct.')
  }
  return trimmed
}

/**
 * The starting probability of each answer pool: 1/n, clamped inside the CPMM's
 * valid weight range.
 */
export function initialAnswerProb(answerCount: number): number {
  const raw = 1 / answerCount
  return Math.min(0.98, Math.max(0.02, raw))
}

export function rowToPool(row: AnswerRow): Pool {
  return { yes: row.pool_yes, no: row.pool_no, p: row.pool_p, k: row.pool_k }
}

export function toAnswerView(row: AnswerRow): AnswerView {
  return {
    id: row.id,
    text: row.text,
    probability: round6(getProb(rowToPool(row))),
    volume: round6(row.volume),
  }
}

export function insertAnswer(
  db: Db,
  input: { marketId: string; ord: number; text: string; pool: Pool }
): string {
  const id = newId('ans')
  db.prepare(
    `INSERT INTO answers
       (id, market_id, ord, text, pool_yes, pool_no, pool_p, pool_k, volume)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`
  ).run(
    id,
    input.marketId,
    input.ord,
    input.text,
    input.pool.yes,
    input.pool.no,
    input.pool.p,
    input.pool.k
  )
  return id
}

export function listAnswerRows(db: Db, marketId: string): AnswerRow[] {
  return db
    .prepare('SELECT * FROM answers WHERE market_id = ? ORDER BY ord ASC')
    .all(marketId) as AnswerRow[]
}

export function getAnswerRow(
  db: Db,
  marketId: string,
  answerId: string
): AnswerRow | null {
  const row = db
    .prepare('SELECT * FROM answers WHERE id = ? AND market_id = ?')
    .get(answerId, marketId) as AnswerRow | undefined
  return row ?? null
}

export function saveAnswerPool(
  db: Db,
  answerId: string,
  pool: Pool,
  volume: number
): void {
  db.prepare(
    `UPDATE answers
        SET pool_yes = ?, pool_no = ?, volume = ROUND(?, 6)
      WHERE id = ?`
  ).run(pool.yes, pool.no, volume, answerId)
}

/**
 * The leading answer (highest probability; earliest ord wins ties). A MULTI
 * market always has >= 2 answers, so this only returns null for corrupt data.
 */
export function leadingAnswer(rows: readonly AnswerRow[]): AnswerRow | null {
  let best: AnswerRow | null = null
  let bestProb = -1
  for (const row of rows) {
    const prob = getProb(rowToPool(row))
    if (prob > bestProb + 1e-12) {
      best = row
      bestProb = prob
    }
  }
  return best
}

/**
 * Leftover pool value returned to the creator when a MULTI market resolves to
 * a winning answer: the winner's pool YES shares pay 1 each, every other
 * answer's pool NO shares pay 1 each.
 */
export function creatorRefundForWinner(
  rows: readonly AnswerRow[],
  winnerId: string
): number {
  let refund = 0
  for (const row of rows) {
    refund += row.id === winnerId ? row.pool_yes : row.pool_no
  }
  return round6(refund)
}
