import { CollectionIcon, ExternalLinkIcon } from '@heroicons/react/solid'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Page } from 'web/components/layout/page'
import { Button } from 'web/components/buttons/button'
import { Col } from 'web/components/layout/col'
import { Row } from 'web/components/layout/row'
import { LoadingIndicator } from 'web/components/widgets/loading-indicator'
import { contractPath } from 'common/contract'
import { api } from 'web/lib/api/api'
import {
  ParlayLeg,
  ResolvedParlayLeg,
  combinedParlayProbability,
  decodeParlayLegs,
  impliedMultiplier,
  sideProbability,
} from 'web/lib/parlay/parlay'

function formatPct(p: number): string {
  return `${Math.round(p * 100)}%`
}

// Shared parlay view: decode the legs from the URL, fetch each real market, and
// render the live combined odds. Read-only — it reflects real market prices.
export default function SharedParlayPage() {
  const router = useRouter()
  const legsParam = router.query.legs

  const [resolved, setResolved] = useState<ResolvedParlayLeg[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (typeof legsParam !== 'string') return
    const legs: ParlayLeg[] = decodeParlayLegs(legsParam)
    if (legs.length === 0) {
      setError('This parlay link is empty or invalid.')
      setLoading(false)
      return
    }

    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const results = await Promise.all(
          legs.map(async (leg) => {
            const market = await api('market/:id', {
              id: leg.contractId,
              lite: true,
            })
            const yesProb =
              typeof market.probability === 'number' ? market.probability : 0.5
            // SECURITY: never render the fetched `market.url` (a raw external
            // URL) directly as an href — that is an open-redirect / injection
            // risk. Build a same-origin INTERNAL path from the market's own
            // creatorUsername/slug via the app's contractPath helper instead.
            const resolvedLeg: ResolvedParlayLeg = {
              contractId: leg.contractId,
              side: leg.side,
              question: market.question,
              url: contractPath(market),
              legProbability: sideProbability(yesProb, leg.side),
            }
            return resolvedLeg
          })
        )
        if (!cancelled) setResolved(results)
      } catch (e) {
        console.error('Error loading parlay legs:', e)
        if (!cancelled)
          setError('Could not load one or more markets in this parlay.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [legsParam])

  const combined = resolved
    ? combinedParlayProbability(resolved.map((l) => l.legProbability))
    : 0
  const multiplier = impliedMultiplier(combined)

  return (
    <Page trackPageView={'shared parlay page'}>
      <Col className="mx-auto w-full max-w-2xl gap-4 p-2 pb-8">
        <Row className="text-ink-900 items-center gap-2 text-2xl font-bold">
          <CollectionIcon className="text-primary-600 h-6 w-6" aria-hidden />
          Parlay
        </Row>

        {loading && (
          <Row className="text-ink-500 items-center gap-2 py-8">
            <LoadingIndicator size="md" /> Loading live odds…
          </Row>
        )}

        {!loading && error && (
          <Col className="border-scarlet-300 bg-scarlet-50 text-scarlet-700 gap-3 rounded-lg border p-4 text-sm">
            <span>{error}</span>
            <Link href="/parlay">
              <Button color="indigo" size="sm">
                Build a new parlay
              </Button>
            </Link>
          </Col>
        )}

        {!loading && !error && resolved && (
          <>
            <Col className="bg-primary-50 gap-1 rounded-lg p-5 text-center">
              <span className="text-primary-700 text-4xl font-bold">
                {formatPct(combined)}
              </span>
              <span className="text-ink-600 text-sm">
                combined chance all {resolved.length} legs hit · pays ~
                {multiplier.toFixed(1)}x
              </span>
              <span className="text-ink-400 text-xs">
                Live odds from real markets, assuming legs are independent.
              </span>
            </Col>

            <Col className="gap-2">
              {resolved.map((leg) => (
                <Row
                  key={leg.contractId}
                  className="bg-canvas-0 border-ink-200 items-center gap-3 rounded-lg border p-3"
                >
                  <span className="text-ink-700 min-w-[3rem] text-lg font-semibold">
                    {formatPct(leg.legProbability)}
                  </span>
                  <Col className="min-w-0 flex-1">
                    <Link
                      href={leg.url}
                      className="text-ink-900 hover:text-primary-600 truncate text-sm font-medium"
                    >
                      {leg.question}
                    </Link>
                    <span className="text-ink-500 text-xs">
                      Betting {leg.side}
                    </span>
                  </Col>
                  <Link
                    href={leg.url}
                    className="text-ink-400 hover:text-primary-600 shrink-0"
                    aria-label="Open market"
                  >
                    <ExternalLinkIcon className="h-4 w-4" aria-hidden />
                  </Link>
                </Row>
              ))}
            </Col>

            <Row className="justify-center pt-2">
              <Link href="/parlay">
                <Button color="indigo-outline" size="sm">
                  Build your own parlay
                </Button>
              </Link>
            </Row>
          </>
        )}
      </Col>
    </Page>
  )
}
