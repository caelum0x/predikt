import { ScaleIcon } from '@heroicons/react/outline'
import clsx from 'clsx'
import { Col } from 'web/components/layout/col'
import { Row } from 'web/components/layout/row'
import { ExpandingInput } from 'web/components/widgets/expanding-input'
import { InfoTooltip } from 'web/components/widgets/info-tooltip'

const MAX_RESOLUTION_CRITERIA_LENGTH = 2000

// Resolution criteria is what makes a market trustworthy: it states exactly how
// and when the market resolves YES/NO (or which option wins). Surfaced
// prominently because clear criteria are the single biggest driver of a healthy
// market. Stored on the form and folded into the description on submit.
export function ResolutionCriteriaSection(props: {
  value: string
  onChange: (value: string) => void
  outcomeType: string | null
}) {
  const { value, onChange, outcomeType } = props

  // Polls resolve by vote count, so criteria are less meaningful there.
  if (outcomeType === 'POLL') return null

  const placeholder =
    outcomeType === 'MULTIPLE_CHOICE'
      ? 'e.g. Resolves to the option that officially wins, per the primary source below.'
      : outcomeType === 'MULTI_NUMERIC' || outcomeType === 'DATE'
      ? 'e.g. Resolves to the bucket containing the official reported value.'
      : outcomeType === 'PSEUDO_NUMERIC'
      ? 'e.g. Resolves to the final reported number from the official source.'
      : 'e.g. Resolves YES if the official result confirms it by the close date, otherwise NO.'

  const isEmpty = value.trim().length === 0

  return (
    <Col className="gap-2 px-4">
      <Row className="items-center gap-2">
        <ScaleIcon className="text-primary-600 h-4 w-4" aria-hidden />
        <span className="text-ink-700 text-sm font-semibold">
          Resolution criteria
        </span>
        <InfoTooltip text="State exactly how and when this market resolves, and name the source of truth. Clear criteria attract traders and prevent disputes." />
      </Row>
      <ExpandingInput
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, MAX_RESOLUTION_CRITERIA_LENGTH))}
        rows={2}
        maxLength={MAX_RESOLUTION_CRITERIA_LENGTH}
        placeholder={placeholder}
        className={clsx(
          'w-full text-sm',
          isEmpty && 'ring-1 ring-amber-300 dark:ring-amber-500/50'
        )}
      />
      {isEmpty && (
        <span className="text-xs text-amber-600 dark:text-amber-400">
          Recommended: markets with clear criteria attract far more traders.
        </span>
      )}
    </Col>
  )
}

export { MAX_RESOLUTION_CRITERIA_LENGTH }
