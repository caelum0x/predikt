// Trade ledger writes. Every executed trade — direct buys/sells and limit
// order fills alike — goes through insertTrade so history, the activity feed,
// and reputation stats see one consistent record shape.

import type { Db } from './store'
import { newId } from './ids'
import { round6, type Side } from './cpmm'

export type TradeInput = {
  marketId: string
  accountId: string
  kind: 'BUY' | 'SELL'
  side: Side
  answerId: string | null
  amount: number
  shares: number
  fee: number
  probBefore: number
  probAfter: number
}

export type TradeReceipt = {
  tradeId: string
  kind: 'BUY' | 'SELL'
  side: Side
  answerId: string | null
  amount: number
  shares: number
  fee: number
  probBefore: number
  probAfter: number
  createdAt: number
}

export function insertTrade(db: Db, input: TradeInput): TradeReceipt {
  const id = newId('trd')
  const now = Date.now()
  db.prepare(
    `INSERT INTO trades
      (id, market_id, account_id, kind, side, answer_id, amount, shares,
       fee, prob_before, prob_after, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.marketId,
    input.accountId,
    input.kind,
    input.side,
    input.answerId,
    round6(input.amount),
    round6(input.shares),
    round6(input.fee),
    input.probBefore,
    input.probAfter,
    now
  )
  return {
    tradeId: id,
    kind: input.kind,
    side: input.side,
    answerId: input.answerId,
    amount: round6(input.amount),
    shares: round6(input.shares),
    fee: round6(input.fee),
    probBefore: round6(input.probBefore),
    probAfter: round6(input.probAfter),
    createdAt: now,
  }
}
