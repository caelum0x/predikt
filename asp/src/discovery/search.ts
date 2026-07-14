// Search & discovery over markets: full-text search (SQLite FTS5 with a
// LIKE-based fallback), category aggregation, and trending-by-volume.
//
// initSearchSchema() must run once per Db handle before searchMarkets(). It
// tries to create an external-content FTS5 table kept in sync with `markets`
// via AFTER INSERT/UPDATE/DELETE triggers. If the build lacks FTS5 (or table
// creation fails for any reason) the module falls back to a fully implemented
// LIKE-based ranking path. The mode is chosen ONCE per Db and recorded.

import type { Db } from '../engine/store'
import { round6 } from '../engine/cpmm'
import type { MarketStatus, OutcomeType } from '../engine/service'

export type SearchMode = 'fts' | 'like'

// Mode chosen at init, per database handle. WeakMap so closed handles can be
// collected. A Db that never ran init searches via the LIKE path (safe).
const modeByDb = new WeakMap<Db, SearchMode>()

// External-content FTS5 table synced to markets. Triggers fire only when the
// indexed text columns change, so trade-driven pool/volume updates cost
// nothing. Everything is IF NOT EXISTS -> idempotent re-runs.
const FTS_SCHEMA = `
CREATE VIRTUAL TABLE IF NOT EXISTS markets_fts USING fts5(
  question, description, criteria, category,
  content='markets', content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS markets_fts_after_insert
AFTER INSERT ON markets BEGIN
  INSERT INTO markets_fts(rowid, question, description, criteria, category)
  VALUES (new.rowid, new.question, new.description, new.criteria, new.category);
END;

CREATE TRIGGER IF NOT EXISTS markets_fts_after_update
AFTER UPDATE OF question, description, criteria, category ON markets BEGIN
  INSERT INTO markets_fts(markets_fts, rowid, question, description, criteria, category)
  VALUES ('delete', old.rowid, old.question, old.description, old.criteria, old.category);
  INSERT INTO markets_fts(rowid, question, description, criteria, category)
  VALUES (new.rowid, new.question, new.description, new.criteria, new.category);
END;

CREATE TRIGGER IF NOT EXISTS markets_fts_after_delete
AFTER DELETE ON markets BEGIN
  INSERT INTO markets_fts(markets_fts, rowid, question, description, criteria, category)
  VALUES ('delete', old.rowid, old.question, old.description, old.criteria, old.category);
END;
`

export type InitSearchOptions = {
  // Test hook: skip FTS entirely and exercise the LIKE path. Only honored on
  // the first init for a given Db (the mode is fixed once chosen).
  forceLikeMode?: boolean
}

// Idempotent: the first call per Db decides the mode; later calls return it.
export function initSearchSchema(
  db: Db,
  options: InitSearchOptions = {}
): SearchMode {
  const existing = modeByDb.get(db)
  if (existing) return existing

  if (options.forceLikeMode) {
    modeByDb.set(db, 'like')
    return 'like'
  }

  try {
    db.exec(FTS_SCHEMA)
    // Backfill rows created before this init (external-content rebuild is a
    // no-op relative to a synced index, so re-running is safe).
    db.exec(`INSERT INTO markets_fts(markets_fts) VALUES('rebuild')`)
    modeByDb.set(db, 'fts')
    return 'fts'
  } catch (err) {
    console.error(
      'FTS5 unavailable; search falls back to LIKE mode:',
      err instanceof Error ? err.message : 'unknown error'
    )
    modeByDb.set(db, 'like')
    return 'like'
  }
}

export function getSearchMode(db: Db): SearchMode {
  return modeByDb.get(db) ?? 'like'
}

// ---- shared row/result shapes ---------------------------------------------

type MarketRowCore = {
  id: string
  question: string
  category: string
  status: MarketStatus
  outcome_type: OutcomeType
  pool_yes: number
  pool_no: number
  pool_p: number
  volume: number
  close_time: number
  created_at: number
}

export type MarketSummary = {
  id: string
  question: string
  category: string
  status: MarketStatus
  outcomeType: OutcomeType
  probability: number
  volume: number
  closeTime: number
  createdAt: number
}

export type SearchResult = MarketSummary & {
  // Higher is more relevant in both modes (-bm25 for FTS, matched-token
  // count for LIKE).
  score: number
}

const MARKET_COLUMNS = `m.id, m.question, m.category, m.status, m.outcome_type,
  m.pool_yes, m.pool_no, m.pool_p, m.volume, m.close_time, m.created_at`

// CPMM YES-price straight from stored pool columns (mirrors cpmm.getProb).
function poolProb(row: { pool_yes: number; pool_no: number; pool_p: number }): number {
  const { pool_yes: yes, pool_no: no, pool_p: p } = row
  const denom = p * no + (1 - p) * yes
  return denom > 0 ? (p * no) / denom : 0
}

type AnswerPoolRow = {
  market_id: string
  pool_yes: number
  pool_no: number
  pool_p: number
}

// Probability per market: its own pool for BINARY, the leading answer's pool
// for MULTI (one bulk answers query for the whole page — no N+1). The
// strictly-greater epsilon keeps the earliest answer on ties, matching
// answers.leadingAnswer.
function probabilityByMarket(
  db: Db,
  rows: readonly MarketRowCore[]
): Map<string, number> {
  const probs = new Map<string, number>()
  const multiIds: string[] = []
  for (const row of rows) {
    if (row.outcome_type === 'MULTI') {
      multiIds.push(row.id)
      probs.set(row.id, 0)
    } else {
      probs.set(row.id, poolProb(row))
    }
  }

  if (multiIds.length > 0) {
    const placeholders = multiIds.map(() => '?').join(', ')
    const answerRows = db
      .prepare(
        `SELECT market_id, pool_yes, pool_no, pool_p FROM answers
         WHERE market_id IN (${placeholders}) ORDER BY ord ASC`
      )
      .all(...multiIds) as AnswerPoolRow[]
    for (const answer of answerRows) {
      const prob = poolProb(answer)
      const best = probs.get(answer.market_id) ?? 0
      if (prob > best + 1e-12) probs.set(answer.market_id, prob)
    }
  }

  return probs
}

function toSummary(row: MarketRowCore, probability: number): MarketSummary {
  return {
    id: row.id,
    question: row.question,
    category: row.category,
    status: row.status,
    outcomeType: row.outcome_type,
    probability: round6(probability),
    volume: round6(row.volume),
    closeTime: row.close_time,
    createdAt: row.created_at,
  }
}

// ---- full-text search -------------------------------------------------------

const MAX_TOKENS = 12

// Reduce a raw query to plain word tokens. Everything that is not a letter,
// number, or underscore is dropped, which neutralizes every FTS5 operator
// (NEAR, AND, OR, -, *, :, unbalanced quotes, ...) before quoting.
function tokenize(q: string): string[] {
  const matches = q.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []
  return matches.slice(0, MAX_TOKENS)
}

// Each token becomes a quoted FTS5 string literal; OR lets bm25 rank markets
// matching more tokens above partial matches.
function ftsMatchExpression(tokens: readonly string[]): string {
  return tokens.map((token) => `"${token.replaceAll('"', '')}"`).join(' OR ')
}

function escapeLike(token: string): string {
  return token.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
}

export type SearchMarketsOptions = {
  q: string
  status?: MarketStatus
  limit?: number
}

type ScoredRow = MarketRowCore & { score: number }

function clampLimit(limit: number | undefined, fallback: number, max: number): number {
  if (limit === undefined || !Number.isFinite(limit)) return fallback
  return Math.min(max, Math.max(1, Math.floor(limit)))
}

function ftsSearch(
  db: Db,
  tokens: readonly string[],
  status: MarketStatus | null,
  limit: number
): ScoredRow[] {
  const rows = db
    .prepare(
      `SELECT ${MARKET_COLUMNS}, bm25(markets_fts) AS score
       FROM markets_fts
       JOIN markets m ON m.rowid = markets_fts.rowid
       WHERE markets_fts MATCH ?
         AND (? IS NULL OR m.status = ?)
       ORDER BY score ASC, m.volume DESC
       LIMIT ?`
    )
    .all(ftsMatchExpression(tokens), status, status, limit) as ScoredRow[]
  // bm25 is "smaller is better" (negative); flip so higher = more relevant.
  return rows.map((row) => ({ ...row, score: -row.score }))
}

function likeSearch(
  db: Db,
  tokens: readonly string[],
  status: MarketStatus | null,
  limit: number
): ScoredRow[] {
  const haystack = `lower(m.question || ' ' || m.description || ' ' || m.criteria || ' ' || m.category)`
  const scoreExpr = tokens
    .map(() => `(CASE WHEN ${haystack} LIKE ? ESCAPE '\\' THEN 1 ELSE 0 END)`)
    .join(' + ')
  const params = [
    ...tokens.map((token) => `%${escapeLike(token)}%`),
    status,
    status,
    limit,
  ]
  return db
    .prepare(
      `SELECT * FROM (
         SELECT ${MARKET_COLUMNS}, (${scoreExpr}) AS score
         FROM markets m
         WHERE (? IS NULL OR m.status = ?)
       )
       WHERE score > 0
       ORDER BY score DESC, volume DESC
       LIMIT ?`
    )
    .all(...params) as ScoredRow[]
}

// Ranked market search. FTS mode uses bm25; LIKE mode ranks by the number of
// query tokens present. Empty/garbage-only queries return [] rather than
// erroring, so hostile FTS syntax can never reach the MATCH parser.
export function searchMarkets(db: Db, options: SearchMarketsOptions): SearchResult[] {
  const tokens = tokenize(options.q)
  if (tokens.length === 0) return []
  const status = options.status ?? null
  const limit = clampLimit(options.limit, 20, 50)

  let rows: ScoredRow[]
  if (getSearchMode(db) === 'fts') {
    try {
      rows = ftsSearch(db, tokens, status, limit)
    } catch (err) {
      // Defense in depth: sanitization should make this unreachable, but a
      // MATCH parse error must never turn into a 500 for the caller.
      console.error(
        'FTS search failed; serving LIKE results:',
        err instanceof Error ? err.message : 'unknown error'
      )
      rows = likeSearch(db, tokens, status, limit)
    }
  } else {
    rows = likeSearch(db, tokens, status, limit)
  }

  const probs = probabilityByMarket(db, rows)
  return rows.map((row) => ({
    ...toSummary(row, probs.get(row.id) ?? 0),
    score: round6(row.score),
  }))
}

// ---- categories -------------------------------------------------------------

export type CategorySummary = {
  category: string
  markets: number
  openMarkets: number
  volume: number
}

type CategoryRow = {
  category: string
  markets: number
  open_markets: number
  volume: number
}

export function listCategories(db: Db): CategorySummary[] {
  const rows = db
    .prepare(
      `SELECT category,
              COUNT(*) AS markets,
              SUM(CASE WHEN status = 'OPEN' THEN 1 ELSE 0 END) AS open_markets,
              SUM(volume) AS volume
       FROM markets
       GROUP BY category
       ORDER BY volume DESC, category ASC`
    )
    .all() as CategoryRow[]
  return rows.map((row) => ({
    category: row.category,
    markets: row.markets,
    openMarkets: row.open_markets,
    volume: round6(row.volume),
  }))
}

// ---- trending ---------------------------------------------------------------

export type TrendingMarket = MarketSummary & {
  windowVolume: number
  windowTrades: number
}

export type TrendingOptions = {
  hours?: number
  limit?: number
}

type TrendingRow = MarketRowCore & {
  window_volume: number
  window_trades: number
}

const MAX_TRENDING_HOURS = 168

// Markets ranked by currency traded within the last `hours` (default 24),
// joined with market info and current probability. Markets with no trades in
// the window simply do not appear.
export function trendingMarkets(db: Db, options: TrendingOptions = {}): TrendingMarket[] {
  const hours = clampLimit(options.hours, 24, MAX_TRENDING_HOURS)
  const limit = clampLimit(options.limit, 10, 50)
  const cutoff = Date.now() - hours * 60 * 60 * 1000

  const rows = db
    .prepare(
      `SELECT ${MARKET_COLUMNS},
              SUM(t.amount) AS window_volume,
              COUNT(t.id) AS window_trades
       FROM trades t
       JOIN markets m ON m.id = t.market_id
       WHERE t.created_at >= ?
       GROUP BY m.id
       ORDER BY window_volume DESC, window_trades DESC, m.created_at DESC
       LIMIT ?`
    )
    .all(cutoff, limit) as TrendingRow[]

  const probs = probabilityByMarket(db, rows)
  return rows.map((row) => ({
    ...toSummary(row, probs.get(row.id) ?? 0),
    windowVolume: round6(row.window_volume),
    windowTrades: row.window_trades,
  }))
}
