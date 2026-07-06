import { CashIcon, CubeIcon } from '@heroicons/react/solid'
import clsx from 'clsx'
import { Col } from 'web/components/layout/col'
import { Row } from 'web/components/layout/row'
import type { MoneyMode } from 'web/lib/compliance/jurisdiction'
import type { MoneyModeState } from 'web/hooks/use-allowed-modes'

/**
 * Segmented switch to see / choose the money mode, rendered ONLY where both
 * modes are allowed for the visitor's area (`state.canSwitch`). Icon-first:
 * a coin glyph for free play money, a cube glyph for on-chain crypto — no tech
 * or product names in the copy.
 *
 * SOFT COMPLIANCE AID — NOT LEGAL ADVICE. Choosing a mode here does not change
 * what's permitted; it only picks which trading path this device uses.
 */
export function MoneyModeToggle(props: {
  state: MoneyModeState
  className?: string
}) {
  const { state, className } = props
  if (!state.canSwitch) return null

  return (
    <Col className={clsx('gap-1', className)}>
      <Row className="bg-canvas-50 rounded-md p-0.5" role="tablist">
        <ModeTab
          active={state.mode === 'play'}
          onClick={() => state.setMode('play')}
          label="Play free"
        >
          <CashIcon className="h-4 w-4" />
        </ModeTab>
        <ModeTab
          active={state.mode === 'onchain'}
          onClick={() => state.setMode('onchain')}
          label="Crypto"
        >
          <CubeIcon className="h-4 w-4" />
        </ModeTab>
      </Row>
      <span className="text-ink-400 text-xs">
        Both modes are available here. Not legal advice.
      </span>
    </Col>
  )
}

function ModeTab(props: {
  active: boolean
  onClick: () => void
  label: string
  children: React.ReactNode
}) {
  const { active, onClick, label, children } = props
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={clsx(
        'flex flex-1 items-center justify-center gap-1.5 rounded py-1.5 text-sm font-semibold transition-colors',
        active ? 'bg-canvas-0 text-ink-900 shadow-sm' : 'text-ink-500'
      )}
    >
      {children}
      <span>{label}</span>
    </button>
  )
}

/** Re-export for callers that only need the mode literal type. */
export type { MoneyMode }
