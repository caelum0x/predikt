import { useUnfilledBetsAndBalanceByUserId } from 'client-common/hooks/use-bets'
import { formatTimeShort } from 'client-common/lib/time'
import clsx from 'clsx'
import { Bet, LimitBet } from 'common/bet'
import { getDisplayProbability } from 'common/calculate'
import {
  BinaryContract,
  PseudoNumericContract,
  StonkContract,
} from 'common/contract'
import { formatPercent } from 'common/util/format'
import { sortBy, sumBy } from 'lodash'
import { useMemo } from 'react'
import { useIsPageVisible } from 'web/hooks/use-page-visible'
import { api } from 'web/lib/api/api'
import { Col } from '../layout/col'
import { Row } from '../layout/row'
import { MoneyDisplay } from './money-display'

type DepthContract = BinaryContract | PseudoNumericContract | StonkContract

// A real, compact market-depth panel: a CPMM price bar sourced from the live
// pool, a bid/ask ladder built from open limit orders, and recent fills. All
// data is real — no placeholders. Renders nothing if there is nothing to show.
export function DepthPanel(props: {
  contract: DepthContract
  bets: Bet[]
  className?: string
}) {
  const { contract, bets, className } = props
  const isCashContract = contract.token === 'CASH'
  const isPseudoNumeric = contract.outcomeType === 'PSEUDO_NUMERIC'

  const { unfilledBets } = useUnfilledBetsAndBalanceByUserId(
    contract.id,
    (params) => api('bets', params),
    (params) => api('users/by-id/balance', params),
    useIsPageVisible
  )

  const openOrders = unfilledBets.filter(
    (b) => (!b.expiresAt || b.expiresAt > Date.now()) && !b.silent
  )

  // Bid = YES orders (willingness to buy YES), Ask = NO orders.
  const yesLadder = ladder(openOrders.filter((b) => b.outcome === 'YES'), 'desc')
  const noLadder = ladder(openOrders.filter((b) => b.outcome === 'NO'), 'asc')
  const hasLadder = !isPseudoNumeric && (yesLadder.length + noLadder.length > 0)

  const recentTrades = useMemo(
    () =>
      sortBy(
        bets.filter((b) => !b.isRedemption && b.amount !== 0),
        (b) => -b.createdTime
      ).slice(0, 6),
    [bets]
  )

  if (isPseudoNumeric && recentTrades.length === 0) return null

  const prob = getDisplayProbability(contract)
  const yesPct = Math.round(prob * 100)

  return (
    <Col
      className={clsx(
        'bg-canvas-0 border-ink-200 dark:border-canvas-100 gap-4 rounded-xl border p-4',
        className
      )}
    >
      {/* CPMM price bar */}
      {!isPseudoNumeric && (
        <Col className="gap-1.5">
          <Row className="text-ink-600 items-center justify-between text-xs font-medium uppercase tracking-wide">
            <span className="text-teal-600">Yes {formatPercent(prob)}</span>
            <span className="text-scarlet-600">No {formatPercent(1 - prob)}</span>
          </Row>
          <div className="bg-scarlet-500/20 flex h-2.5 overflow-hidden rounded-full">
            <div
              className="bg-teal-500 h-full"
              style={{ width: `${yesPct}%` }}
            />
          </div>
        </Col>
      )}

      {/* Bid/ask ladder from open limit orders */}
      {hasLadder && (
        <Col className="gap-1.5">
          <span className="text-ink-500 text-xs font-medium uppercase tracking-wide">
            Open orders
          </span>
          <Row className="gap-3">
            <LadderSide
              rows={yesLadder}
              side="YES"
              isCashContract={isCashContract}
            />
            <LadderSide
              rows={noLadder}
              side="NO"
              isCashContract={isCashContract}
            />
          </Row>
        </Col>
      )}

      {/* Recent trades */}
      {recentTrades.length > 0 && (
        <Col className="gap-1.5">
          <span className="text-ink-500 text-xs font-medium uppercase tracking-wide">
            Recent trades
          </span>
          <Col className="gap-0.5">
            {recentTrades.map((bet) => (
              <RecentTradeRow
                key={bet.id}
                bet={bet}
                isCashContract={isCashContract}
              />
            ))}
          </Col>
        </Col>
      )}
    </Col>
  )
}

type LadderRow = { prob: number; total: number; max: number }

function ladder(bets: LimitBet[], dir: 'asc' | 'desc'): LadderRow[] {
  const byProb = new Map<number, number>()
  for (const b of bets) {
    byProb.set(b.limitProb, (byProb.get(b.limitProb) ?? 0) + b.orderAmount - b.amount)
  }
  const rows = [...byProb.entries()]
    .filter(([, total]) => total > 0)
    .map(([prob, total]) => ({ prob, total }))
  const sorted = sortBy(rows, (r) => (dir === 'desc' ? -r.prob : r.prob)).slice(
    0,
    5
  )
  const max = Math.max(1, ...sorted.map((r) => r.total))
  return sorted.map((r) => ({ ...r, max }))
}

function LadderSide(props: {
  rows: LadderRow[]
  side: 'YES' | 'NO'
  isCashContract: boolean
}) {
  const { rows, side, isCashContract } = props
  const isYes = side === 'YES'
  const barColor = isYes ? 'bg-teal-500/15' : 'bg-scarlet-500/15'
  const textColor = isYes ? 'text-teal-600' : 'text-scarlet-600'

  return (
    <Col className="min-w-0 flex-1 gap-0.5">
      <span className={clsx('text-xs font-semibold', textColor)}>{side}</span>
      {rows.length === 0 ? (
        <span className="text-ink-400 py-1 text-xs">No orders</span>
      ) : (
        rows.map((r) => (
          <div key={r.prob} className="relative">
            <div
              className={clsx('absolute inset-y-0 rounded', barColor, {
                'right-0': !isYes,
                'left-0': isYes,
              })}
              style={{ width: `${(r.total / r.max) * 100}%` }}
            />
            <Row className="relative items-center justify-between px-1.5 py-0.5 text-xs">
              <span className={textColor}>{formatPercent(r.prob)}</span>
              <span className="text-ink-700 font-medium">
                <MoneyDisplay
                  amount={r.total}
                  numberType="short"
                  isCashContract={isCashContract}
                />
              </span>
            </Row>
          </div>
        ))
      )}
    </Col>
  )
}

function RecentTradeRow(props: { bet: Bet; isCashContract: boolean }) {
  const { bet, isCashContract } = props
  const isYes = bet.outcome === 'YES'
  const isSell = bet.amount < 0
  return (
    <Row className="items-center justify-between text-xs">
      <Row className="items-center gap-2">
        <span
          className={clsx(
            'font-semibold',
            isYes ? 'text-teal-600' : 'text-scarlet-600'
          )}
        >
          {isSell ? 'Sold ' : ''}
          {bet.outcome}
        </span>
        <span className="text-ink-500">{formatPercent(bet.probAfter)}</span>
      </Row>
      <Row className="items-center gap-2">
        <span className="text-ink-700 font-medium">
          <MoneyDisplay
            amount={Math.abs(bet.amount)}
            numberType="short"
            isCashContract={isCashContract}
          />
        </span>
        <span className="text-ink-400 w-9 text-right">
          {formatTimeShort(bet.createdTime)}
        </span>
      </Row>
    </Row>
  )
}
