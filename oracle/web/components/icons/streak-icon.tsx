import clsx from 'clsx'
import { TbFlame, TbSnowflake } from 'react-icons/tb'

/**
 * Vector streak icon: a flame for an active streak, a snowflake for a frozen
 * one. Replaces the 🔥 / 🧊 emoji glyphs used throughout streak UI.
 */
export function StreakIcon(props: {
  frozen?: boolean
  className?: string
}) {
  const { frozen, className } = props
  if (frozen) {
    return (
      <TbSnowflake
        role="img"
        aria-label="Streak frozen"
        className={clsx('text-cyan-500', className)}
      />
    )
  }
  return (
    <TbFlame
      role="img"
      aria-label="Streak"
      className={clsx('text-orange-500', className)}
    />
  )
}
