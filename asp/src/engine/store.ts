// SQLite persistence for the market engine. Schema is applied idempotently on
// open. Use ':memory:' in tests.

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
  outcome       TEXT,                               -- YES | NO | CANCEL
  pool_yes      REAL NOT NULL,
  pool_no       REAL NOT NULL,
  pool_p        REAL NOT NULL,
  pool_k        REAL NOT NULL,
  subsidy       REAL NOT NULL,
  volume        REAL NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  resolved_at   INTEGER
);

CREATE TABLE IF NOT EXISTS positions (
  account_id    TEXT NOT NULL REFERENCES accounts(id),
  market_id     TEXT NOT NULL REFERENCES markets(id),
  yes_shares    REAL NOT NULL DEFAULT 0,
  no_shares     REAL NOT NULL DEFAULT 0,
  invested      REAL NOT NULL DEFAULT 0,            -- net cost basis
  PRIMARY KEY (account_id, market_id)
);

CREATE TABLE IF NOT EXISTS trades (
  id            TEXT PRIMARY KEY,
  market_id     TEXT NOT NULL REFERENCES markets(id),
  account_id    TEXT NOT NULL REFERENCES accounts(id),
  kind          TEXT NOT NULL,                      -- BUY | SELL
  side          TEXT NOT NULL,                      -- YES | NO
  amount        REAL NOT NULL,                      -- currency in (BUY) / out (SELL)
  shares        REAL NOT NULL,
  fee           REAL NOT NULL DEFAULT 0,
  prob_before   REAL NOT NULL,
  prob_after    REAL NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_markets_status ON markets(status);
CREATE INDEX IF NOT EXISTS idx_trades_market ON trades(market_id);
CREATE INDEX IF NOT EXISTS idx_positions_market ON positions(market_id);
`

export function openDb(path: string): Db {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA)
  return db
}
