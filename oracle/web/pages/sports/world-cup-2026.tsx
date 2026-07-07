import { MdSportsSoccer } from 'react-icons/md'
import { SportsDashboardPage } from 'web/components/sports/sports-dashboard-page'

export default function WorldCupDashboard() {
  return (
    <SportsDashboardPage
      sportsLeague="FIFA World Cup"
      title="FIFA World Cup 2026"
      emoji={<MdSportsSoccer />}
      trackPageView="world cup dashboard"
      competitionCode="WC"
      communityDashboardSlug="ms-community-wc2026"
    />
  )
}
