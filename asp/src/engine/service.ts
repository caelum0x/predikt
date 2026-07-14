// Business logic for the agent prediction market. All mutations run inside
// SQLite transactions; every balance/share change is atomic. Amounts are in
// PRED credits (1 credit = 1 USDT-equivalent once x402 deposits are wired).

import type { Db } from './store'
import { hashApiKey, newApiKey, newId } from './ids'
import {
  calcBuy,
  calcSell,
  CpmmError,
  getProb,
  initPool,
  round6,
  type Pool,
  type Side,
} from './cpmm'

// Every new agent account starts with a play-money grant so the market is
// usable the moment an agent signs up. Replaced by x402 deposits later.
export const SIGNUP_GRANT = 1000
// Fee on buys, credited to the market creator (their incentive to make
// well-specified markets). Sells are fee-free.
export const BUY_FEE_RATE = 0.01
export const MIN_SUBSIDY = 10
export const MAX_QUESTION_LEN = 240

export type MarketStatus = 'OPEN' | 'CLOSED' | 'RESOLVED'
export type Outcome = 'YES' | 'NO' | 'CANCEL'

export class ServiceError extends Error {
  readonly status: 400 | 401 | 402 | 403 | 404 | 409
  constructor(status: 400 | 401 | 402 | 403 | 404 | 409, message: string) {
    super(message)
    this.name = 'ServiceError'
    this.status = status
  }
}

export type Account = {
  id: string
  name: string
  balance: number
  createdAt: number
}

export type Market = {
  id: string
  creatorId: string
  question: string
  description: string
  criteria: string
  category: string
  closeTime: number
  status: MarketStatus
  outcome: Outcome | null
  probability: number
  subsidy: number
  volume: number
  createdAt: number
  resolvedAt: number | null
}

export type Position = {
  accountId: string
  marketId: string
  yesShares: number
  noShares: number
  invested: number
}

export type CreateMarketInput = {
  question: string
  criteria: string
  description?: string
  category?: string
  closeTime: number
  initialProb?: number
  subsidy?: number
}

type MarketRow = {
  id: string
  creator_id: string
  question: string
  description: string
  criteria: string
  category: string
  close_time: number
  status: MarketStatus
  outcome: Outcome | null
  pool_yes: number
  pool_no: number
  pool_p: number
  pool_k: number
  subsidy: number
  volume: number
  created_at: number
  resolved_at: number | null
}

type AccountRow = {
  id: string
  name: string
  balance: number
  created_at: number
}

type PositionRow = {
  account_id: string
  market_id: string
  yes_shares: number
  no_shares: number
  invested: number
}

export class MarketService {
  constructor(private readonly db: Db) {}

  // ---- accounts -----------------------------------------------------------

  createAccount(name: string): { account: Account; apiKey: string } {
    const trimmed = name.trim()
    if (trimmed.length < 2 || trimmed.length > 80) {
      throw new ServiceError(400, 'Account name must be 2-80 characters.')
    }
    const apiKey = newApiKey()
    const id = newId('acct')
    const now = Date.now()
    this.db
      .prepare(
        'INSERT INTO accounts (id, name, api_key_hash, balance, created_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(id, trimmed, hashApiKey(apiKey), SIGNUP_GRANT, now)
    return {
      account: { id, name: trimmed, balance: SIGNUP_GRANT, createdAt: now },
      apiKey,
    }
  }

  getAccountByKey(apiKey: string): Account | null {
    const row = this.db
      .prepare('SELECT * FROM accounts WHERE api_key_hash = ?')
      .get(hashApiKey(apiKey)) as AccountRow | undefined
    return row ? toAccount(row) : null
  }

  getAccount(id: string): Account {
    const row = this.db
      .prepare('SELECT * FROM accounts WHERE id = ?')
      .get(id) as AccountRow | undefined
    if (!row) throw new ServiceError(404, 'Account not found.')
    return toAccount(row)
  }

  getPositions(accountId: string): Position[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM positions WHERE account_id = ? AND (yes_shares > 0 OR no_shares > 0)'
      )
      .all(accountId) as PositionRow[]
    return rows.map(toPosition)
  }

  // ---- markets ------------------------------------------------------------

  createMarket(creatorId: string, input: CreateMarketInput): Market {
    const question = input.question.trim()
    const criteria = input.criteria.trim()
    if (question.length < 8 || question.length > MAX_QUESTION_LEN) {
      throw new ServiceError(400, 'Question must be 8-240 characters.')
    }
    if (criteria.length < 10) {
      throw new ServiceError(
        400,
        'Resolution criteria must be at least 10 characters.'
      )
    }
    if (!Number.isFinite(input.closeTime) || input.closeTime <= Date.now()) {
      throw new ServiceError(400, 'closeTime must be in the future.')
    }
    const subsidy = input.subsidy ?? MIN_SUBSIDY
    if (subsidy < MIN_SUBSIDY) {
      throw new ServiceError(400, `Subsidy must be at least ${MIN_SUBSIDY}.`)
    }

    let pool: Pool
    try {
      pool = initPool(subsidy, input.initialProb ?? 0.5)
    } catch (err) {
      throw new ServiceError(
        400,
        err instanceof CpmmError ? err.message : 'Invalid market parameters.'
      )
    }

    const run = this.db.transaction((): Market => {
      this.debit(creatorId, subsidy, 'market subsidy')
      const id = newId('mkt')
      const now = Date.now()
      this.db
        .prepare(
          `INSERT INTO markets
            (id, creator_id, question, description, criteria, category,
             close_time, status, pool_yes, pool_no, pool_p, pool_k,
             subsidy, volume, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, ?, 0, ?)`
        )
        .run(
          id,
          creatorId,
          question,
          input.description?.trim() ?? '',
          criteria,
          input.category?.trim() || 'General',
          input.closeTime,
          pool.yes,
          pool.no,
          pool.p,
          pool.k,
          subsidy,
          now
        )
      return this.getMarket(id)
    })
    return run()
  }

  listMarkets(status?: MarketStatus): Market[] {
    const rows = (
      status
        ? this.db
            .prepare(
              'SELECT * FROM markets WHERE status = ? ORDER BY created_at DESC LIMIT 200'
            )
            .all(status)
        : this.db
            .prepare('SELECT * FROM markets ORDER BY created_at DESC LIMIT 200')
            .all()
    ) as MarketRow[]
    return rows.map(toMarket)
  }

  getMarket(id: string): Market {
    const row = this.getMarketRow(id)
    return toMarket(row)
  }

  // ---- trading ------------------------------------------------------------

  quote(marketId: string, side: Side, amount: number): {
    shares: number
    probBefore: number
    probAfter: number
    fee: number
  } {
    const row = this.requireTradable(this.getMarketRow(marketId))
    const fee = round6(amount * BUY_FEE_RATE)
    const result = this.tryCpmm(() =>
      calcBuy(rowPool(row), side, round6(amount - fee))
    )
    return {
      shares: result.shares,
      probBefore: getProb(rowPool(row)),
      probAfter: round6(result.probAfter),
      fee,
    }
  }

  buy(accountId: string, marketId: string, side: Side, amount: number) {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new ServiceError(400, 'Amount must be positive.')
    }
    const run = this.db.transaction(() => {
      const row = this.requireTradable(this.getMarketRow(marketId))
      const fee = round6(amount * BUY_FEE_RATE)
      const probBefore = getProb(rowPool(row))
      const result = this.tryCpmm(() =>
        calcBuy(rowPool(row), side, round6(amount - fee))
      )

      this.debit(accountId, amount, 'buy')
      this.credit(row.creator_id, fee)
      this.savePool(row.id, result.newPool, row.volume + amount)
      this.adjustPosition(accountId, row.id, side, result.shares, amount)

      const trade = this.recordTrade({
        marketId: row.id,
        accountId,
        kind: 'BUY',
        side,
        amount,
        shares: result.shares,
        fee,
        probBefore,
        probAfter: result.probAfter,
      })
      return { ...trade, balance: this.getAccount(accountId).balance }
    })
    return run()
  }

  sell(accountId: string, marketId: string, side: Side, shares: number) {
    if (!Number.isFinite(shares) || shares <= 0) {
      throw new ServiceError(400, 'Shares must be positive.')
    }
    const run = this.db.transaction(() => {
      const row = this.requireTradable(this.getMarketRow(marketId))
      const position = this.getPositionRow(accountId, marketId)
      const held = side === 'YES' ? position.yes_shares : position.no_shares
      if (held + 1e-9 < shares) {
        throw new ServiceError(
          400,
          `You hold ${round6(held)} ${side} shares, cannot sell ${shares}.`
        )
      }
      const probBefore = getProb(rowPool(row))
      const result = this.tryCpmm(() => calcSell(rowPool(row), side, shares))

      this.credit(accountId, result.amount)
      this.savePool(row.id, result.newPool, row.volume + result.amount)
      this.adjustPosition(accountId, row.id, side, -shares, -result.amount)

      const trade = this.recordTrade({
        marketId: row.id,
        accountId,
        kind: 'SELL',
        side,
        amount: result.amount,
        shares,
        fee: 0,
        probBefore,
        probAfter: result.probAfter,
      })
      return { ...trade, balance: this.getAccount(accountId).balance }
    })
    return run()
  }

  // ---- lifecycle ----------------------------------------------------------

  closeMarket(accountId: string, marketId: string): Market {
    const run = this.db.transaction(() => {
      const row = this.getMarketRow(marketId)
      this.requireCreator(row, accountId)
      if (row.status !== 'OPEN') {
        throw new ServiceError(409, 'Market is not open.')
      }
      this.db
        .prepare("UPDATE markets SET status = 'CLOSED' WHERE id = ?")
        .run(marketId)
      return this.getMarket(marketId)
    })
    return run()
  }

  resolveMarket(
    accountId: string,
    marketId: string,
    outcome: Outcome
  ): Market {
    const run = this.db.transaction(() => {
      const row = this.getMarketRow(marketId)
      this.requireCreator(row, accountId)
      if (row.status === 'RESOLVED') {
        throw new ServiceError(409, 'Market is already resolved.')
      }

      const positions = this.db
        .prepare('SELECT * FROM positions WHERE market_id = ?')
        .all(marketId) as PositionRow[]

      for (const pos of positions) {
        const payout = payoutFor(pos, outcome)
        if (payout > 0) this.credit(pos.account_id, payout)
      }

      // Leftover pool value returns to the creator: the pool's winning-side
      // shares each pay 1; on CANCEL the original subsidy is refunded.
      const creatorRefund =
        outcome === 'CANCEL'
          ? row.subsidy
          : outcome === 'YES'
          ? row.pool_yes
          : row.pool_no
      if (creatorRefund > 0) this.credit(row.creator_id, round6(creatorRefund))

      this.db
        .prepare(
          "UPDATE markets SET status = 'RESOLVED', outcome = ?, resolved_at = ? WHERE id = ?"
        )
        .run(outcome, Date.now(), marketId)
      return this.getMarket(marketId)
    })
    return run()
  }

  // ---- internals ----------------------------------------------------------

  private getMarketRow(id: string): MarketRow {
    const row = this.db.prepare('SELECT * FROM markets WHERE id = ?').get(id) as
      | MarketRow
      | undefined
    if (!row) throw new ServiceError(404, 'Market not found.')
    return row
  }

  private requireTradable(row: MarketRow): MarketRow {
    if (row.status !== 'OPEN') {
      throw new ServiceError(409, 'Market is not open for trading.')
    }
    if (Date.now() >= row.close_time) {
      throw new ServiceError(409, 'Market is past its close time.')
    }
    return row
  }

  private requireCreator(row: MarketRow, accountId: string): void {
    if (row.creator_id !== accountId) {
      throw new ServiceError(403, 'Only the market creator can do this.')
    }
  }

  private tryCpmm<T>(fn: () => T): T {
    try {
      return fn()
    } catch (err) {
      if (err instanceof CpmmError) throw new ServiceError(400, err.message)
      throw err
    }
  }

  private debit(accountId: string, amount: number, what: string): void {
    const account = this.getAccount(accountId)
    if (account.balance + 1e-9 < amount) {
      throw new ServiceError(
        402,
        `Insufficient balance for ${what}: need ${round6(amount)}, have ${round6(
          account.balance
        )}.`
      )
    }
    this.db
      .prepare('UPDATE accounts SET balance = ROUND(balance - ?, 6) WHERE id = ?')
      .run(amount, accountId)
  }

  private credit(accountId: string, amount: number): void {
    this.db
      .prepare('UPDATE accounts SET balance = ROUND(balance + ?, 6) WHERE id = ?')
      .run(amount, accountId)
  }

  private savePool(marketId: string, pool: Pool, volume: number): void {
    this.db
      .prepare(
        'UPDATE markets SET pool_yes = ?, pool_no = ?, volume = ROUND(?, 6) WHERE id = ?'
      )
      .run(pool.yes, pool.no, volume, marketId)
  }

  private getPositionRow(accountId: string, marketId: string): PositionRow {
    const row = this.db
      .prepare(
        'SELECT * FROM positions WHERE account_id = ? AND market_id = ?'
      )
      .get(accountId, marketId) as PositionRow | undefined
    return (
      row ?? {
        account_id: accountId,
        market_id: marketId,
        yes_shares: 0,
        no_shares: 0,
        invested: 0,
      }
    )
  }

  private adjustPosition(
    accountId: string,
    marketId: string,
    side: Side,
    sharesDelta: number,
    investedDelta: number
  ): void {
    const pos = this.getPositionRow(accountId, marketId)
    const yes = round6(pos.yes_shares + (side === 'YES' ? sharesDelta : 0))
    const no = round6(pos.no_shares + (side === 'NO' ? sharesDelta : 0))
    const invested = round6(pos.invested + investedDelta)
    this.db
      .prepare(
        `INSERT INTO positions (account_id, market_id, yes_shares, no_shares, invested)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(account_id, market_id)
         DO UPDATE SET yes_shares = excluded.yes_shares,
                       no_shares = excluded.no_shares,
                       invested = excluded.invested`
      )
      .run(accountId, marketId, Math.max(0, yes), Math.max(0, no), invested)
  }

  private recordTrade(input: {
    marketId: string
    accountId: string
    kind: 'BUY' | 'SELL'
    side: Side
    amount: number
    shares: number
    fee: number
    probBefore: number
    probAfter: number
  }) {
    const id = newId('trd')
    const now = Date.now()
    this.db
      .prepare(
        `INSERT INTO trades
          (id, market_id, account_id, kind, side, amount, shares, fee,
           prob_before, prob_after, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.marketId,
        input.accountId,
        input.kind,
        input.side,
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
      amount: round6(input.amount),
      shares: round6(input.shares),
      fee: round6(input.fee),
      probBefore: round6(input.probBefore),
      probAfter: round6(input.probAfter),
      createdAt: now,
    }
  }
}

function payoutFor(pos: PositionRow, outcome: Outcome): number {
  if (outcome === 'YES') return round6(pos.yes_shares)
  if (outcome === 'NO') return round6(pos.no_shares)
  return Math.max(0, round6(pos.invested)) // CANCEL: refund net cost basis
}

function rowPool(row: MarketRow): Pool {
  return { yes: row.pool_yes, no: row.pool_no, p: row.pool_p, k: row.pool_k }
}

function toAccount(row: AccountRow): Account {
  return {
    id: row.id,
    name: row.name,
    balance: round6(row.balance),
    createdAt: row.created_at,
  }
}

function toMarket(row: MarketRow): Market {
  return {
    id: row.id,
    creatorId: row.creator_id,
    question: row.question,
    description: row.description,
    criteria: row.criteria,
    category: row.category,
    closeTime: row.close_time,
    status: row.status,
    outcome: row.outcome,
    probability: round6(getProb(rowPool(row))),
    subsidy: row.subsidy,
    volume: round6(row.volume),
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  }
}

function toPosition(row: PositionRow): Position {
  return {
    accountId: row.account_id,
    marketId: row.market_id,
    yesShares: round6(row.yes_shares),
    noShares: round6(row.no_shares),
    invested: round6(row.invested),
  }
}
