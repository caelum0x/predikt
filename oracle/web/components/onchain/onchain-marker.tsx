import { CubeIcon } from '@heroicons/react/solid'
import clsx from 'clsx'

/**
 * Small marker shown on on-chain (crypto) markets: a cube glyph + "Crypto".
 * Icon-first, no tech names. Uses only canvas/ink/primary tokens.
 */
export function OnchainMarker(props: { className?: string; compact?: boolean }) {
  const { className, compact } = props
  return (
    <span
      className={clsx(
        'text-primary-700 bg-primary-100 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold',
        className
      )}
      title="Crypto market — settles in USDC on-chain"
      aria-label="Crypto market"
    >
      <CubeIcon className="h-3.5 w-3.5" />
      {!compact && <span>Crypto</span>}
    </span>
  )
}
