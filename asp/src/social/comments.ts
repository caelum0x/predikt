// Market comments with skin-in-the-game disclosure. Agents publish their
// rationale on a market; each comment stores an immutable snapshot of the
// author's position (yes/no shares + net cost basis) taken at post time, so
// readers always see what the author had at stake WHEN they said it — later
// trades never rewrite that history.
//
// Storage is an extra `comments` table created idempotently by
// initCommentsSchema(db); the engine schema (store.ts) is untouched.

import type { Db } from '../engine/store'
import { round6 } from '../engine/cpmm'
import { newId } from '../engine/ids'
import { ServiceError } from '../engine/service'

export const MAX_COMMENT_LENGTH = 2000
export const DELETED_BODY = '[deleted]'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS comments (
  id                TEXT PRIMARY KEY,
  market_id         TEXT NOT NULL REFERENCES markets(id),
  account_id        TEXT NOT NULL REFERENCES accounts(id),
  reply_to          TEXT REFERENCES comments(id),
  body              TEXT NOT NULL,
  -- Position disclosure snapshot, frozen at post time (immutable history).
  position_yes      REAL NOT NULL DEFAULT 0,
  position_no       REAL NOT NULL DEFAULT 0,
  position_invested REAL NOT NULL DEFAULT 0,
  is_deleted        INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_market ON comments(market_id, created_at);
`

/** Idempotently creates the comments table + index. Safe to call repeatedly. */
export function initCommentsSchema(db: Db): void {
  db.exec(SCHEMA)
}

export type PositionDisclosure = {
  yesShares: number
  noShares: number
  invested: number
}

export type CommentView = {
  id: string
  marketId: string
  accountId: string
  accountName: string
  body: string
  replyTo: string | null
  position: PositionDisclosure
  createdAt: number
}

export type PostCommentInput = {
  marketId: string
  accountId: string
  body: string
  replyTo?: string | null
}

export type ListCommentsInput = {
  marketId: string
  limit: number
  before?: number | undefined
}

type CommentRow = {
  id: string
  market_id: string
  account_id: string
  reply_to: string | null
  body: string
  position_yes: number
  position_no: number
  position_invested: number
  is_deleted: number
  created_at: number
}

type CommentWithNameRow = CommentRow & { account_name: string }

const MAX_EPOCH = Number.MAX_SAFE_INTEGER

/**
 * The commenting account's current stake in a market: yes/no shares and net
 * cost basis, summed across answer positions for MULTI markets (a binary
 * market has at most one row). All zeros when the account holds nothing.
 */
export function positionDisclosure(
  db: Db,
  accountId: string,
  marketId: string
): PositionDisclosure {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(yes_shares), 0)  AS yes,
              COALESCE(SUM(no_shares), 0)   AS no,
              COALESCE(SUM(invested), 0)    AS invested
       FROM positions WHERE account_id = ? AND market_id = ?`
    )
    .get(accountId, marketId) as { yes: number; no: number; invested: number }
  return {
    yesShares: round6(row.yes),
    noShares: round6(row.no),
    invested: round6(row.invested),
  }
}

/**
 * Publishes a comment. Validates the market exists and, when replying, that
 * the parent comment belongs to the same market. The author's position
 * snapshot is computed here and frozen onto the row.
 */
export function postComment(db: Db, input: PostCommentInput): CommentView {
  const body = input.body.trim()
  if (body.length < 1 || body.length > MAX_COMMENT_LENGTH) {
    throw new ServiceError(
      400,
      `Comment body must be 1-${MAX_COMMENT_LENGTH} characters.`
    )
  }
  requireMarket(db, input.marketId)

  const replyTo = input.replyTo ?? null
  if (replyTo !== null) {
    const parent = db
      .prepare('SELECT id, market_id FROM comments WHERE id = ?')
      .get(replyTo) as { id: string; market_id: string } | undefined
    if (!parent) {
      throw new ServiceError(400, 'replyTo comment not found.')
    }
    if (parent.market_id !== input.marketId) {
      throw new ServiceError(
        400,
        'replyTo comment belongs to a different market.'
      )
    }
  }

  const position = positionDisclosure(db, input.accountId, input.marketId)
  const id = newId('cmt')
  const createdAt = Date.now()
  db.prepare(
    `INSERT INTO comments
       (id, market_id, account_id, reply_to, body,
        position_yes, position_no, position_invested, is_deleted, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
  ).run(
    id,
    input.marketId,
    input.accountId,
    replyTo,
    body,
    position.yesShares,
    position.noShares,
    position.invested,
    createdAt
  )

  const row = getCommentRow(db, id)
  // Unreachable in practice (we just inserted this id); a plain Error maps to
  // a 500 via the route's error handler without widening ServiceError's codes.
  if (!row) throw new Error('Comment insert failed.')
  return toView(row)
}

/**
 * Newest-first comments for a market with a `created_at < before` cursor.
 * Soft-deleted rows are kept in the thread but rendered as '[deleted]' with a
 * zeroed position.
 */
export function listComments(db: Db, input: ListCommentsInput): CommentView[] {
  requireMarket(db, input.marketId)
  const rows = db
    .prepare(
      `SELECT c.*, a.name AS account_name
       FROM comments c
       JOIN accounts a ON a.id = c.account_id
       WHERE c.market_id = ? AND c.created_at < ?
       ORDER BY c.created_at DESC, c.id DESC
       LIMIT ?`
    )
    .all(
      input.marketId,
      input.before ?? MAX_EPOCH,
      input.limit
    ) as CommentWithNameRow[]
  return rows.map(toView)
}

/**
 * Author-only soft delete: the body is replaced with '[deleted]' and the row
 * flagged, but it stays in place so replies keep a valid thread parent.
 */
export function deleteComment(
  db: Db,
  commentId: string,
  accountId: string
): CommentView {
  const row = getCommentRow(db, commentId)
  if (!row) throw new ServiceError(404, 'Comment not found.')
  if (row.account_id !== accountId) {
    throw new ServiceError(403, 'Only the comment author can delete it.')
  }
  if (row.is_deleted === 1) {
    throw new ServiceError(409, 'Comment is already deleted.')
  }
  db.prepare('UPDATE comments SET body = ?, is_deleted = 1 WHERE id = ?').run(
    DELETED_BODY,
    commentId
  )
  return toView({ ...row, body: DELETED_BODY, is_deleted: 1 })
}

// ---- internals -------------------------------------------------------------

function requireMarket(db: Db, marketId: string): void {
  const row = db
    .prepare('SELECT id FROM markets WHERE id = ?')
    .get(marketId) as { id: string } | undefined
  if (!row) throw new ServiceError(404, 'Market not found.')
}

function getCommentRow(db: Db, id: string): CommentWithNameRow | undefined {
  return db
    .prepare(
      `SELECT c.*, a.name AS account_name
       FROM comments c
       JOIN accounts a ON a.id = c.account_id
       WHERE c.id = ?`
    )
    .get(id) as CommentWithNameRow | undefined
}

// Deleted comments always render with a scrubbed body and a zeroed position,
// regardless of what the stored snapshot columns hold.
function toView(row: CommentWithNameRow): CommentView {
  const deleted = row.is_deleted === 1
  return {
    id: row.id,
    marketId: row.market_id,
    accountId: row.account_id,
    accountName: row.account_name,
    body: deleted ? DELETED_BODY : row.body,
    replyTo: row.reply_to,
    position: deleted
      ? { yesShares: 0, noShares: 0, invested: 0 }
      : {
          yesShares: round6(row.position_yes),
          noShares: round6(row.position_no),
          invested: round6(row.position_invested),
        },
    createdAt: row.created_at,
  }
}
