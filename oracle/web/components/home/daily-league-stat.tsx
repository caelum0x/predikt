import Link from 'next/link'

import clsx from 'clsx'
import { DIVISION_NAMES, getLeaguePath } from 'common/leagues'
import { dailyStatsClass } from 'web/components/home/daily-stats'
import { DivisionMedalIcon } from 'web/components/icons/rank-medal-icon'
import { useLeagueInfo } from 'web/hooks/use-leagues'
import { track } from 'web/lib/service/analytics'
import { Col } from '../layout/col'

export const DailyLeagueStat = (props: {
  userId: string | null | undefined
  className?: string
}) => {
  const { userId, className } = props
  const info = useLeagueInfo(userId)

  if (!info || info.division === undefined) {
    return null
  }
  return (
    <Link
      prefetch={false}
      href={getLeaguePath(
        info.season,
        info.division,
        info.cohort,
        userId ?? undefined
      )}
      onClick={() => track('click daily leagues button')}
    >
      <Col
        className={
          className ? className : clsx(dailyStatsClass, 'relative items-center')
        }
      >
        <div className="flex items-center gap-1 whitespace-nowrap">
          <DivisionMedalIcon
            division={info.division}
            className="h-4 w-4 shrink-0"
          />
          {info.rank}
        </div>
        <div className="text-ink-600 text-xs">
          {DIVISION_NAMES[info.division]}
        </div>
      </Col>
    </Link>
  )
}
