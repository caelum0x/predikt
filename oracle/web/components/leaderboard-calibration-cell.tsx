import clsx from 'clsx'
import { useAPIGetter } from 'web/hooks/use-api-getter'
import {
  computeCalibrationScore,
  getCalibrationScoreColor,
} from 'web/lib/util/calibration-score'

// Enriches a leaderboard row with the trader's real calibration score, fetched
// from the cached `get-user-calibration` endpoint (24h server cache). Renders a
// dash while loading or when there aren't enough resolved trades to score.

const colorClass = {
  teal: 'text-teal-600',
  scarlet: 'text-scarlet-500',
  ink: 'text-ink-600',
} as const

export function LeaderboardCalibrationCell(props: { userId: string }) {
  const { userId } = props
  const { data, loading } = useAPIGetter('get-user-calibration', { userId })

  if (loading) {
    return <span className="text-ink-300">…</span>
  }

  const score = data
    ? computeCalibrationScore(
        data.calibration.yesPoints,
        data.calibration.noPoints
      )
    : null

  if (score === null) {
    return <span className="text-ink-400">—</span>
  }

  return (
    <span className={clsx(colorClass[getCalibrationScoreColor(score)])}>
      {score}
    </span>
  )
}
