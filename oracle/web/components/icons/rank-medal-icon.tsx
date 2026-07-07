import clsx from 'clsx'
import { DIVISION_NAMES } from 'common/leagues'
import { TbMedal, TbMedal2, TbRobot, TbTrophy } from 'react-icons/tb'

// Rank / division medal colors, keyed by division number.
// Mirrors DIVISION_STYLES accents but as a flat text color for the icon glyph.
const DIVISION_ICON_COLOR: { [key: number]: string } = {
  0: 'text-ink-500', // Bot
  1: 'text-amber-600 dark:text-amber-500', // Bronze
  2: 'text-slate-400 dark:text-slate-300', // Silver
  3: 'text-yellow-500 dark:text-yellow-400', // Gold
  4: 'text-cyan-500 dark:text-cyan-400', // Platinum
  5: 'text-violet-500 dark:text-violet-400', // Diamond
  6: 'text-rose-500 dark:text-rose-400', // Masters
}

// Podium colors for the top-three rank positions (1st/2nd/3rd).
const PODIUM_COLOR: { [rank: number]: string } = {
  1: 'text-yellow-500 dark:text-yellow-400', // Gold
  2: 'text-slate-400 dark:text-slate-300', // Silver
  3: 'text-amber-600 dark:text-amber-500', // Bronze
}

/**
 * A vector medal/trophy icon standing in for the medal emoji glyphs
 * (bronze/silver/gold/platinum/diamond/masters). Colored per division.
 */
export function DivisionMedalIcon(props: {
  division: number
  className?: string
}) {
  const { division, className } = props
  const color = DIVISION_ICON_COLOR[division] ?? DIVISION_ICON_COLOR[1]
  const name = DIVISION_NAMES[division] ?? 'Division'
  const Icon = division === 0 ? TbRobot : TbTrophy
  return (
    <Icon
      role="img"
      aria-label={`${name} division`}
      className={clsx(color, className)}
    />
  )
}

/**
 * A vector medal icon for a top-three finishing rank. Gold/silver/bronze
 * colored; ranks outside the top three get a neutral medal.
 */
export function RankMedalIcon(props: { rank: number; className?: string }) {
  const { rank, className } = props
  const color = PODIUM_COLOR[rank] ?? 'text-ink-400'
  const Icon = rank <= 3 ? TbMedal : TbMedal2
  return (
    <Icon
      role="img"
      aria-label={`Rank ${rank}`}
      className={clsx(color, className)}
    />
  )
}
