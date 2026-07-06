import clsx from 'clsx'
import { BinaryContract, contractPath } from 'common/contract'
import { getDisplayProbability } from 'common/calculate'
import { DOMAIN } from 'common/envs/constants'
import { formatPercent } from 'common/util/format'
import { ArrowRightIcon } from '@heroicons/react/solid'
import { BinaryContractChart } from 'web/components/charts/contract/binary'
import { SingleContractPoint } from 'web/components/charts/contract/single-value'
import { Col } from 'web/components/layout/col'
import { Row } from 'web/components/layout/row'
import { SizedContainer } from 'web/components/sized-container'

/**
 * Clean, dark, self-contained embeddable widget for a BINARY market.
 *
 * Designed to live inside a third-party <iframe> anywhere on the web:
 * - No auth required to render (all data comes in as props from the page's
 *   static/live contract data — see pages/embed/[username]/[contractSlug].tsx).
 * - Icon-first, plain copy, theme tokens only (canvas-*, ink-*, primary-*,
 *   yes-*, no-*).
 * - Big YES / NO price, a mini price chart, and a deep link back to the market.
 */
export function BinaryEmbedWidget(props: {
  contract: BinaryContract
  points: SingleContractPoint[] | null
}) {
  const { contract, points } = props
  const { question } = contract

  const yesProb = getDisplayProbability(contract)
  const noProb = 1 - yesProb
  const resolved = !!contract.resolution

  const href = `https://${DOMAIN}${contractPath(contract)}`

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={clsx(
        'bg-canvas-0 group flex h-[100vh] w-full flex-col gap-3 px-5 py-4',
        'no-underline'
      )}
    >
      <div
        className="text-ink-1000 line-clamp-3 text-lg font-semibold leading-snug sm:text-xl"
        title={question}
      >
        {question}
      </div>

      <Row className="items-stretch gap-2">
        <PriceTile
          label="Yes"
          value={formatPercent(yesProb)}
          tone="yes"
          dimmed={resolved && contract.resolution !== 'YES'}
        />
        <PriceTile
          label="No"
          value={formatPercent(noProb)}
          tone="no"
          dimmed={resolved && contract.resolution !== 'NO'}
        />
      </Row>

      {points && points.length > 1 && (
        <div className="relative min-h-0 w-full flex-1">
          <SizedContainer className="text-ink-1000 h-full w-full">
            {(w, h) => (
              <BinaryContractChart
                contract={contract}
                betPoints={points}
                width={w}
                height={h}
              />
            )}
          </SizedContainer>
        </div>
      )}

      <Row className="text-ink-500 group-hover:text-primary-600 mt-auto items-center justify-end gap-1 text-sm transition-colors">
        <span>Trade on Predikt</span>
        <ArrowRightIcon className="h-4 w-4" aria-hidden />
      </Row>
    </a>
  )
}

function PriceTile(props: {
  label: string
  value: string
  tone: 'yes' | 'no'
  dimmed?: boolean
}) {
  const { label, value, tone, dimmed } = props
  return (
    <Col
      className={clsx(
        'flex-1 items-center gap-0.5 rounded-lg px-3 py-2',
        tone === 'yes' ? 'bg-yes-100' : 'bg-no-100',
        dimmed && 'opacity-40'
      )}
    >
      <span
        className={clsx(
          'text-xs font-medium uppercase tracking-wide',
          tone === 'yes' ? 'text-yes-700' : 'text-no-700'
        )}
      >
        {label}
      </span>
      <span
        className={clsx(
          'text-2xl font-bold tabular-nums sm:text-3xl',
          tone === 'yes' ? 'text-yes-600' : 'text-no-600'
        )}
      >
        {value}
      </span>
    </Col>
  )
}
