import clsx from 'clsx'
import Link from 'next/link'
import { formatMoney } from 'common/util/format'
import { useAPIGetter } from 'web/hooks/use-api-getter'
import { Row } from 'web/components/layout/row'
import { Col } from 'web/components/layout/col'
import { InfoTooltip } from 'web/components/widgets/info-tooltip'
import {
  computeCalibrationScore,
  getCalibrationScoreColor,
} from 'web/lib/util/calibration-score'

// Surfaces a trader's real reputation on their profile: a calibration accuracy
// score, lifetime profit, and win rate. Every value comes from the real
// `get-user-calibration` endpoint (resolved-trade data) — nothing is faked.

type StatColor = 'teal' | 'scarlet' | 'ink'

const colorClass: Record<StatColor, string> = {
  teal: 'text-teal-600',
  scarlet: 'text-scarlet-500',
  ink: 'text-ink-900',
}

function ReputationStat(props: {
  label: string
  value: string
  color?: StatColor
  tooltip: string
}) {
  const { label, value, color = 'ink', tooltip } = props
  return (
    <Col className="bg-canvas-50 border-ink-200 min-w-[7rem] flex-1 rounded-lg border px-3 py-2">
      <Row className="text-ink-500 items-center gap-1 text-xs">
        {label}
        <InfoTooltip text={tooltip} />
      </Row>
      <span className={clsx('text-lg font-semibold tabular-nums', colorClass[color])}>
        {value}
      </span>
    </Col>
  )
}

export function TraderReputation(props: {
  userId: string
  username: string
  className?: string
}) {
  const { userId, username, className } = props
  const { data, loading, error } = useAPIGetter('get-user-calibration', {
    userId,
  })

  if (loading || error || !data) return null

  const { performanceStats, calibration } = data
  const calibrationScore = computeCalibrationScore(
    calibration.yesPoints,
    calibration.noPoints
  )
  const hasCalibration = calibrationScore !== null

  return (
    <Row className={clsx('flex-wrap gap-2', className)}>
      <ReputationStat
        label="Calibration"
        value={hasCalibration ? `${calibrationScore}/100` : '—'}
        color={getCalibrationScoreColor(calibrationScore)}
        tooltip="How closely this trader's probabilities match reality across resolved trades. 100 = perfectly calibrated."
      />
      <ReputationStat
        label="Profit"
        value={formatMoney(performanceStats.totalProfit, 'MANA')}
        color={performanceStats.totalProfit >= 0 ? 'teal' : 'scarlet'}
        tooltip="All-time net profit (balance + investments − deposits)."
      />
      <ReputationStat
        label="Win rate"
        value={`${performanceStats.winRate.toFixed(0)}%`}
        tooltip="Share of resolved markets this trader finished in profit."
      />
      <Link
        href={`/${username}/calibration`}
        className="bg-canvas-50 border-ink-200 text-primary-600 hover:bg-canvas-100 flex min-w-[7rem] flex-1 flex-col justify-center rounded-lg border px-3 py-2 text-sm font-medium transition-colors"
      >
        Full analytics →
      </Link>
    </Row>
  )
}
