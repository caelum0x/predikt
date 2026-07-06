import { CollectionIcon } from '@heroicons/react/solid'
import { Page } from 'web/components/layout/page'
import { Col } from 'web/components/layout/col'
import { Row } from 'web/components/layout/row'
import { ParlayBuilder } from 'web/components/parlay/parlay-builder'

// Build a shareable parlay (combo) from real markets. Client-side only — no new
// market is created; this produces a deep link over existing markets' live odds.
export default function ParlayPage() {
  return (
    <Page trackPageView={'parlay builder page'}>
      <Col className="mx-auto w-full max-w-2xl gap-4 p-2 pb-8">
        <Col className="gap-1.5">
          <Row className="text-ink-900 items-center gap-2 text-2xl font-bold">
            <CollectionIcon className="text-primary-600 h-6 w-6" aria-hidden />
            Build a parlay
          </Row>
          <p className="text-ink-600 text-sm">
            Bundle 2–4 yes/no markets into one shareable combo. The combined odds
            come straight from each market&apos;s live price.
          </p>
        </Col>
        <ParlayBuilder />
      </Col>
    </Page>
  )
}
