import {
  ExternalLinkIcon,
  LockClosedIcon,
  ShieldCheckIcon,
} from '@heroicons/react/solid'
import clsx from 'clsx'
import { Col } from 'web/components/layout/col'
import { Row } from 'web/components/layout/row'
import { getOnchainAddresses } from 'web/lib/onchain/addresses'
import type { ConditionId } from 'web/lib/onchain/market'
import {
  explorerAddressUrl,
  shortHex,
} from 'web/lib/onchain/resolution'

/**
 * On-chain facts panel for a crypto market: the plain, verifiable truth about
 * how it settles. Every value is a REAL address/id from lib/onchain — no mocks.
 * Renders nothing when the on-chain deployment isn't configured.
 *
 * Copy stays plain (no protocol/product names). Theme tokens only.
 */
export function TransparencyPanel(props: {
  conditionId: ConditionId
  className?: string
}) {
  const { conditionId, className } = props
  const addresses = getOnchainAddresses()
  if (!addresses) return null

  const conditionUrl = explorerAddressUrl(addresses.conditionalTokens)
  const collateralUrl = explorerAddressUrl(addresses.usdc)
  const adapterUrl = explorerAddressUrl(addresses.umaAdapter)

  return (
    <Col
      className={clsx(
        'border-ink-200 bg-canvas-0 gap-2 rounded-lg border p-4',
        className
      )}
    >
      <Row className="text-ink-700 items-center gap-1.5 text-sm font-semibold">
        <LockClosedIcon className="text-primary-500 h-4 w-4" />
        <span>On-chain settlement</span>
      </Row>

      <Row className="text-ink-600 items-start gap-1.5 text-xs">
        <ShieldCheckIcon className="text-primary-500 mt-px h-4 w-4 shrink-0" />
        <span>Once settled, the result is on-chain and can&apos;t be changed.</span>
      </Row>

      <Col className="mt-1 gap-1.5">
        <Fact label="Market id" value={shortHex(conditionId)} />
        <Fact
          label="Collateral"
          value="USDC"
          href={collateralUrl}
          hrefTitle="View the collateral token on the public chain"
        />
        <Fact
          label="Settlement"
          value={shortHex(addresses.umaAdapter)}
          href={adapterUrl}
          hrefTitle="View the settlement contract on the public chain"
        />
        <Fact
          label="Positions"
          value={shortHex(addresses.conditionalTokens)}
          href={conditionUrl}
          hrefTitle="View the positions contract on the public chain"
        />
      </Col>
    </Col>
  )
}

function Fact(props: {
  label: string
  value: string
  href?: string | null
  hrefTitle?: string
}) {
  const { label, value, href, hrefTitle } = props
  return (
    <Row className="items-center justify-between gap-2 text-xs">
      <span className="text-ink-500">{label}</span>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          title={hrefTitle}
          className="text-primary-600 inline-flex items-center gap-1 font-mono font-medium hover:underline"
        >
          <span>{value}</span>
          <ExternalLinkIcon className="h-3 w-3" />
        </a>
      ) : (
        <span className="text-ink-700 font-mono font-medium">{value}</span>
      )}
    </Row>
  )
}
