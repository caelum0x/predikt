// SQLite persistence for the market engine. Schema is applied idempotently on
// open. Use ':memory:' in tests.
//
// Migration strategy: the base SCHEMA uses CREATE TABLE IF NOT EXISTS so a
// fresh database gets the latest shape immediately, and applyMigrations()
// upgrades pre-existing databases in place (pragma table_info checks before
// ALTER TABLE / table rebuilds), so both paths converge on the same schema.

import Database from 'better-sqlite3'

export type Db = Database.Database

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  api_key_hash  TEXT NOT NULL UNIQUE,
  balance       REAL NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS markets (
  id            TEXT PRIMARY KEY,
  creator_id    TEXT NOT NULL REFERENCES accounts(id),
  question      TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  criteria      TEXT NOT NULL,
  category      TEXT NOT NULL DEFAULT 'General',
  close_time    INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'OPEN',       -- OPEN | CLOSED | RESOLVED
  outcome       TEXT,                               -- YES | NO | CANCEL | answer id (MULTI)
  outcome_type  TEXT NOT NULL DEFAULT 'BINARY',     -- BINARY | MULTI
  pool_yes      REAL NOT NULL,
  pool_no       REAL NOT NULL,
  pool_p        REAL NOT NULL,
  pool_k        REAL NOT NULL,
  subsidy       REAL NOT NULL,
  volume        REAL NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  resolved_at   INTEGER
);

-- One independent binary CPMM pool per answer of a MULTI market.
CREATE TABLE IF NOT EXISTS answers (
  id            TEXT PRIMARY KEY,
  market_id     TEXT NOT NULL REFERENCES markets(id),
  ord           INTEGER NOT NULL,
  text          TEXT NOT NULL,
  pool_yes      REAL NOT NULL,
  pool_no       REAL NOT NULL,
  pool_p        REAL NOT NULL,
  pool_k        REAL NOT NULL,
  volume        REAL NOT NULL DEFAULT 0
);

-- answer_id is '' for binary-market positions (a sentinel keeps it inside the
-- primary key: SQLite treats NULLs in composite PKs as distinct, which would
-- break the ON CONFLICT upsert).
CREATE TABLE IF NOT EXISTS positions (
  account_id    TEXT NOT NULL REFERENCES accounts(id),
  market_id     TEXT NOT NULL REFERENCES markets(id),
  answer_id     TEXT NOT NULL DEFAULT '',
  yes_shares    REAL NOT NULL DEFAULT 0,
  no_shares     REAL NOT NULL DEFAULT 0,
  invested      REAL NOT NULL DEFAULT 0,            -- net cost basis
  PRIMARY KEY (account_id, market_id, answer_id)
);

CREATE TABLE IF NOT EXISTS trades (
  id            TEXT PRIMARY KEY,
  market_id     TEXT NOT NULL REFERENCES markets(id),
  account_id    TEXT NOT NULL REFERENCES accounts(id),
  kind          TEXT NOT NULL,                      -- BUY | SELL
  side          TEXT NOT NULL,                      -- YES | NO
  answer_id     TEXT,                               -- NULL for binary markets
  amount        REAL NOT NULL,                      -- currency in (BUY) / out (SELL)
  shares        REAL NOT NULL,
  fee           REAL NOT NULL DEFAULT 0,
  prob_before   REAL NOT NULL,
  prob_after    REAL NOT NULL,
  created_at    INTEGER NOT NULL
);

-- Limit orders resting against the AMM. Funds are reserved: placement debits
-- amount_total from the balance, fills spend from amount_remaining, and
-- cancellation (manual or at resolution) refunds amount_remaining.
CREATE TABLE IF NOT EXISTS limit_orders (
  id                TEXT PRIMARY KEY,
  market_id         TEXT NOT NULL REFERENCES markets(id),
  answer_id         TEXT,                             -- NULL for binary markets
  account_id        TEXT NOT NULL REFERENCES accounts(id),
  side              TEXT NOT NULL,                    -- YES | NO
  limit_prob        REAL NOT NULL,                    -- 0.01 .. 0.99
  amount_total      REAL NOT NULL,
  amount_remaining  REAL NOT NULL,
  status            TEXT NOT NULL DEFAULT 'OPEN',     -- OPEN | FILLED | CANCELLED
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_markets_status ON markets(status);
CREATE INDEX IF NOT EXISTS idx_limit_orders_market ON limit_orders(market_id, status);
CREATE INDEX IF NOT EXISTS idx_limit_orders_account ON limit_orders(account_id);
CREATE INDEX IF NOT EXISTS idx_trades_market ON trades(market_id);
CREATE INDEX IF NOT EXISTS idx_positions_market ON positions(market_id);
CREATE INDEX IF NOT EXISTS idx_answers_market ON answers(market_id);
`

function hasColumn(db: Db, table: string, column: string): boolean {
  const cols = db.pragma(`table_info(${table})`) as { name: string }[]
  return cols.some((col) => col.name === column)
}

// Upgrades databases created before multi-outcome markets existed. Every step
// checks the current shape first, so re-running is always a no-op.
function applyMigrations(db: Db): void {
  if (!hasColumn(db, 'markets', 'outcome_type')) {
    db.exec(
      "ALTER TABLE markets ADD COLUMN outcome_type TEXT NOT NULL DEFAULT 'BINARY'"
    )
  }
  if (!hasColumn(db, 'trades', 'answer_id')) {
    db.exec('ALTER TABLE trades ADD COLUMN answer_id TEXT')
  }
  if (!hasColumn(db, 'positions', 'answer_id')) {
    // The primary key must incorporate answer_id, which requires a table
    // rebuild. Existing rows are binary positions -> answer_id ''.
    db.exec(`
      BEGIN;
      CREATE TABLE positions_next (
        account_id    TEXT NOT NULL REFERENCES accounts(id),
        market_id     TEXT NOT NULL REFERENCES markets(id),
        answer_id     TEXT NOT NULL DEFAULT '',
        yes_shares    REAL NOT NULL DEFAULT 0,
        no_shares     REAL NOT NULL DEFAULT 0,
        invested      REAL NOT NULL DEFAULT 0,
        PRIMARY KEY (account_id, market_id, answer_id)
      );
      INSERT INTO positions_next
        (account_id, market_id, answer_id, yes_shares, no_shares, invested)
      SELECT account_id, market_id, '', yes_shares, no_shares, invested
        FROM positions;
      DROP TABLE positions;
      ALTER TABLE positions_next RENAME TO positions;
      CREATE INDEX IF NOT EXISTS idx_positions_market ON positions(market_id);
      COMMIT;
    `)
  }
}

export function openDb(path: string): Db {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA)
  applyMigrations(db)
  return db
}
