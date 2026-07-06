import clsx from 'clsx'
import { useCallback, useEffect, useState } from 'react'
import { Col } from 'web/components/layout/col'
import { Row } from 'web/components/layout/row'
import {
  getTrades,
  priceFromWad,
  type RelayBook,
  type RelayOrderView,
  type RelayTrade,
} from 'web/lib/onchain/orders'

/**
 * Compact order-book + recent-trades panel for an on-chain outcome token.
 *
 * Depth (bid/ask) is read from the relay's `GET /book` (passed in by the trade
 * box so the two stay in sync) and recent settled fills from `GET /trades`.
 * Everything degrades gracefully to an explicit empty state when the relay
 * returns nothing — no fabricated liquidity.
 */
export function OnchainOrderBook(props: {
  tokenId: string
  outcome: 'YES' | 'NO'
  /** Book snapshot shared from the trade box (already fetched from GET /book). */
  book: RelayBook | null
}) {
  const { tokenId, outcome, book } = props
  const [trades, setTrades] = useState<RelayTrade[] | null>(null)

  const loadTrades = useCallback(async () => {
    try {
      const res = await getTrades(tokenId)
      setTrades(res.trades)
    } catch {
      setTrades(null)
    }
  }, [tokenId])

  useEffect(() => {
    loadTrades()
  }, [loadTrades])

  // Depth rows: asks shown high→low above, bids high→low below (Polymarket-style).
  const asks = aggregate(book?.asks ?? [])
    .slice()
    .sort((a, b) => b.price - a.price)
  const bids = aggregate(book?.bids ?? [])
    .slice()
    .sort((a, b) => b.price - a.price)

  const maxSize = Math.max(
    1,
    ...asks.map((r) => r.size),
    ...bids.map((r) => r.size)
  )

  const hasBook = asks.length > 0 || bids.length > 0
  const recent = (trades ?? []).slice(0, 8)

  return (
    <Col className="border-ink-200 bg-canvas-0 gap-3 rounded-lg border p-4">
      <Row className="text-ink-700 items-center justify-between text-sm font-semibold">
        <span>Order book · {outcome}</span>
        <span className="text-ink-400 text-xs font-normal">on-chain</span>
      </Row>

      {hasBook ? (
        <Col className="gap-0.5 text-xs">
          {asks.map((r) => (
            <DepthRow key={`a-${r.price}`} row={r} maxSize={maxSize} side="ask" />
          ))}
          <Row className="text-ink-400 border-ink-100 my-1 justify-between border-y py-1">
            <span>Spread</span>
            <span>{spreadLabel(asks, bids)}</span>
          </Row>
          {bids.map((r) => (
            <DepthRow key={`b-${r.price}`} row={r} maxSize={maxSize} side="bid" />
          ))}
        </Col>
      ) : (
        <span className="text-ink-400 py-2 text-center text-xs">
          No resting orders yet. Place a limit order to seed the book.
        </span>
      )}

      <Col className="gap-1">
        <span className="text-ink-500 text-xs font-semibold">Recent trades</span>
        {recent.length > 0 ? (
          <Col className="gap-0.5 text-xs">
            {recent.map((t, i) => (
              <Row
                key={t.txHash ?? t.makerHash ?? i}
                className="text-ink-600 justify-between"
              >
                <span className={clsx(t.side === 'SELL' ? 'text-scarlet-600' : 'text-teal-600')}>
                  {tradePrice(t)}
                </span>
                <span>{t.shares ? trimShares(t.shares) : '—'}</span>
                <span className="text-ink-400">{tradeTime(t)}</span>
              </Row>
            ))}
          </Col>
        ) : (
          <span className="text-ink-400 text-xs">No trades settled yet.</span>
        )}
      </Col>
    </Col>
  )
}

interface DepthRowData {
  price: number
  size: number
}

/** Aggregate resting orders into price levels (remaining maker size). */
function aggregate(orders: RelayOrderView[]): DepthRowData[] {
  const levels = new Map<number, number>()
  for (const o of orders) {
    const price = priceFromWad(o.priceWad)
    // remainingMaker is in USDC base units for a bid, share base units for an
    // ask; normalize to a display size in whole units (6-dp) for the depth bar.
    const size = Number(o.remainingMaker) / 1e6
    levels.set(price, (levels.get(price) ?? 0) + size)
  }
  return Array.from(levels.entries()).map(([price, size]) => ({ price, size }))
}

function DepthRow(props: {
  row: DepthRowData
  maxSize: number
  side: 'bid' | 'ask'
}) {
  const { row, maxSize, side } = props
  const pct = Math.min(100, (row.size / maxSize) * 100)
  return (
    <Row className="relative items-center justify-between px-1 py-0.5">
      <div
        className={clsx(
          'absolute inset-y-0 right-0 rounded-sm opacity-20',
          side === 'ask' ? 'bg-scarlet-400' : 'bg-teal-400'
        )}
        style={{ width: `${pct}%` }}
      />
      <span
        className={clsx(
          'relative font-medium',
          side === 'ask' ? 'text-scarlet-700' : 'text-teal-700'
        )}
      >
        {(row.price * 100).toFixed(1)}¢
      </span>
      <span className="text-ink-600 relative">{row.size.toFixed(2)}</span>
    </Row>
  )
}

function spreadLabel(asks: DepthRowData[], bids: DepthRowData[]): string {
  if (asks.length === 0 || bids.length === 0) return '—'
  const bestAsk = Math.min(...asks.map((a) => a.price))
  const bestBid = Math.max(...bids.map((b) => b.price))
  const spread = (bestAsk - bestBid) * 100
  return `${spread.toFixed(1)}¢`
}

function tradePrice(t: RelayTrade): string {
  const p =
    t.price != null
      ? Number(t.price)
      : t.priceWad != null
      ? priceFromWad(t.priceWad)
      : null
  if (p == null || !Number.isFinite(p)) return '—'
  const cents = p <= 1 ? p * 100 : p
  return `${cents.toFixed(1)}¢`
}

function trimShares(s: string): string {
  const n = Number(s)
  if (!Number.isFinite(n)) return s
  // shares often arrive as 6-dp base units; show a compact whole-share value.
  const whole = n > 1e6 ? n / 1e6 : n
  return whole.toFixed(2)
}

function tradeTime(t: RelayTrade): string {
  if (!t.timestamp) return ''
  const ms = t.timestamp < 1e12 ? t.timestamp * 1000 : t.timestamp
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
