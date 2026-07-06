// Derives a single calibration accuracy score (0-100) from the real
// calibration points returned by the `get-user-calibration` API.
//
// This is a deterministic transform of real resolved-trade data — it does NOT
// invent numbers. Each point is (x = probability the trader traded at,
// y = fraction of those markets that actually resolved YES). A perfectly
// calibrated trader sits on the diagonal (y === x). We measure the mean
// absolute calibration error (MACE) and map it to an intuitive 0-100 score.

export interface CalibrationPoint {
  x: number
  y: number
}

// The worst meaningful average error is ~0.5 (always maximally wrong), so we
// scale by 2 to spread the score across the full 0-100 range.
const MAX_MEANINGFUL_ERROR = 0.5

export function computeCalibrationScore(
  yesPoints: readonly CalibrationPoint[],
  noPoints: readonly CalibrationPoint[]
): number | null {
  const points = [...yesPoints, ...noPoints]
  if (points.length === 0) return null

  const totalAbsError = points.reduce(
    (sum, point) => sum + Math.abs(point.y - point.x),
    0
  )
  const meanAbsError = totalAbsError / points.length

  const rawScore = (1 - meanAbsError / MAX_MEANINGFUL_ERROR) * 100
  return Math.round(Math.max(0, Math.min(100, rawScore)))
}

export function getCalibrationScoreColor(
  score: number | null
): 'teal' | 'ink' | 'scarlet' {
  if (score === null) return 'ink'
  if (score >= 70) return 'teal'
  if (score < 45) return 'scarlet'
  return 'ink'
}
