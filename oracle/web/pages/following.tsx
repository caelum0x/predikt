import { UserGroupIcon } from '@heroicons/react/outline'
import { Col } from 'web/components/layout/col'
import { Page } from 'web/components/layout/page'
import { Row } from 'web/components/layout/row'
import { SEO } from 'web/components/SEO'
import { SiteActivity } from 'web/components/site-activity'
import { useRedirectIfSignedOut } from 'web/hooks/use-redirect-if-signed-out'

// A dedicated "following" feed: the recent trades and activity of the people
// you follow. Reuses the existing site-activity feed pinned to followed-users,
// which already reads the real follows + bets data.
export default function FollowingPage() {
  useRedirectIfSignedOut()

  return (
    <Page trackPageView={'following feed'}>
      <SEO
        title="Following"
        description="Recent trades and activity from the traders you follow."
        url="/following"
      />

      <Col className="w-full max-w-3xl gap-4 self-center sm:pb-4">
        <Row className="items-center gap-2 pt-1">
          <UserGroupIcon className="text-primary-600 h-6 w-6" />
          <span className="text-primary-700 line-clamp-1 shrink px-1 text-2xl">
            Following
          </span>
        </Row>
        <SiteActivity className="w-full" defaultFilterMode="followed-users" />
      </Col>
    </Page>
  )
}
