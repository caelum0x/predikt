import { InformationCircleIcon } from '@heroicons/react/outline'
import clsx from 'clsx'
import { Row } from 'web/components/layout/row'

/**
 * Short, plain-language explainer shown when the on-chain (crypto) path is not
 * offered for the visitor's area, so the market falls back to free play money.
 *
 * SOFT COMPLIANCE AID — NOT LEGAL ADVICE. This is a convenience default based on
 * a coarse geo signal that can be wrong; it makes no legal determination. Uses
 * only canvas/ink tokens, icon-first, no tech or product names.
 */
export function MoneyModeNotice(props: { className?: string }) {
  const { className } = props
  return (
    <Row
      className={clsx(
        'text-ink-600 bg-canvas-50 border-ink-200 items-start gap-2 rounded-md border p-3 text-sm',
        className
      )}
      role="note"
    >
      <InformationCircleIcon className="text-ink-400 mt-0.5 h-4 w-4 shrink-0" />
      <span>
        Crypto trading isn&apos;t available in your area — play free instead.{' '}
        <span className="text-ink-400">
          This is an automatic default and not legal advice.
        </span>
      </span>
    </Row>
  )
}
