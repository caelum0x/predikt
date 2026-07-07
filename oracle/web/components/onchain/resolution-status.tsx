import {
  CheckCircleIcon,
  ClockIcon,
  ExternalLinkIcon,
  ShieldCheckIcon,
} from '@heroicons/react/solid'
import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { Col } from 'web/components/layout/col'
import { Row } from 'web/components/layout/row'
import type { ConditionId } from 'web/lib/onchain/market'
import {
  explorerAddressUrl,
  readResolutionStatus,
  type ResolutionPhase,
  type ResolutionStatus,
} from 'web/lib/onchain/resolution'
import { getOnchainAddresses } from 'web/lib/onchain/addresses'

/**
 * Compact, plain, icon-first badge + one-line panel showing how a crypto market
 * settles: trustlessly, on-chain, open to challenge by anyone. Reads REAL state
 * from the chain (see lib/onchain/resolution.ts) and hides itself for off-chain
 * markets or when the on-chain state can't be read.
 *
 * Copy stays plain — no protocol/product names in visible text. Uses only theme
 * tokens (canvas/ink/primary blue, teal green, scarlet red).
 */
export function ResolutionStatusPanel(props: {
  conditionId: ConditionId
  questionId?: `0x${string}` | null
  className?: string
}) {
  const { conditionId, questionId, className } = props
  const [status, setStatus] = useState<ResolutionStatus | null>(null)

  useEffect(() => {
    // Guard the interval-driven async read against setState-after-unmount:
    // clearInterval stops future ticks, but a read already in flight at
    // unmount would otherwise resolve and set state on a dead component.
    let active = true
    const load = async () => {
      try {
        const next = await readResolutionStatus(conditionId, questionId ?? null)
        if (active) setStatus(next)
      } catch {
        if (active) setStatus(null)
      }
    }
    load()
    // Refresh while a dispute window may be counting down.
    const timer = setInterval(load, 60_000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [conditionId, questionId])

  if (!status || status.phase === 'NotOnchain' || status.phase === 'Unknown') {
    return null
  }

  const verifyUrl = resolveVerifyUrl()

  return (
    <Col
      className={clsx(
        'border-ink-200 bg-canvas-0 gap-2 rounded-lg border p-3',
        className
      )}
    >
      <Row className="items-center justify-between gap-2">
        <StatusBadge phase={status.phase} label={status.label} />
        {verifyUrl && (
          <a
            href={verifyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary-600 inline-flex items-center gap-1 text-xs font-semibold hover:underline"
            title="Verify this market on the public chain"
          >
            <span>Verify on-chain</span>
            <ExternalLinkIcon className="h-3.5 w-3.5" />
          </a>
        )}
      </Row>

      <Row className="text-ink-600 items-start gap-1.5 text-xs">
        <ShieldCheckIcon className="text-primary-500 mt-px h-4 w-4 shrink-0" />
        <span>
          Settled trustlessly by an optimistic oracle — anyone can dispute.
        </span>
      </Row>
    </Col>
  )
}

interface PhaseStyle {
  icon: typeof ClockIcon
  /** Tailwind classes for the badge chip, theme tokens only. */
  chip: string
}

function phaseStyle(phase: ResolutionPhase): PhaseStyle {
  switch (phase) {
    case 'Resolved':
      return {
        icon: CheckCircleIcon,
        chip: 'bg-teal-100 text-teal-700',
      }
    case 'Proposed':
      return {
        icon: ClockIcon,
        chip: 'bg-primary-100 text-primary-700',
      }
    case 'Pending':
    default:
      return {
        icon: ClockIcon,
        chip: 'text-ink-600 bg-ink-100',
      }
  }
}

function StatusBadge(props: { phase: ResolutionPhase; label: string }) {
  const { phase, label } = props
  const { icon: Icon, chip } = phaseStyle(phase)
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold',
        chip
      )}
      aria-label={label}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span>{label}</span>
    </span>
  )
}

/**
 * Prefer verifying the CTF adapter contract (where settlement is enforced). Real
 * address from lib/onchain — returns null when the deployment isn't configured.
 */
function resolveVerifyUrl(): string | null {
  const addresses = getOnchainAddresses()
  if (!addresses) return null
  return explorerAddressUrl(addresses.umaAdapter)
}
