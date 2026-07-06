import { CheckCircleIcon } from '@heroicons/react/solid'
import dayjs from 'dayjs'
import { formatMoney } from 'common/util/format'
import { Button } from 'web/components/buttons/button'
import { Col } from 'web/components/layout/col'
import { Modal } from 'web/components/layout/modal'
import { Row } from 'web/components/layout/row'
import { FormState } from './contextual-editor-panel'

const TYPE_LABEL: Record<string, string> = {
  BINARY: 'Yes / No',
  MULTIPLE_CHOICE: 'Multiple choice',
  MULTI_NUMERIC: 'Numeric',
  DATE: 'Date',
  PSEUDO_NUMERIC: 'Numeric',
  POLL: 'Poll',
}

// Final review step: a plain summary of exactly what will be created, so the
// user confirms deliberately. Reads only from the already-validated form state.
export function ReviewSubmitModal(props: {
  open: boolean
  setOpen: (open: boolean) => void
  formState: FormState
  cost: number
  isFreeMarket: boolean
  willBoost: boolean
  boostCost: number
  useOnchain: boolean
  onConfirm: () => void
  isSubmitting: boolean
}) {
  const {
    open,
    setOpen,
    formState,
    cost,
    isFreeMarket,
    willBoost,
    boostCost,
    useOnchain,
    onConfirm,
    isSubmitting,
  } = props

  const outcomeType = formState.outcomeType ?? 'BINARY'
  const typeLabel = TYPE_LABEL[outcomeType] ?? outcomeType

  const nonEmptyAnswers = formState.answers.filter((a) => a.trim().length > 0)

  const closeLabel = formState.neverCloses
    ? 'Never closes'
    : formState.closeDate
    ? dayjs(
        formState.closeDate + 'T' + (formState.closeHoursMinutes || '23:59')
      ).format('MMM D, YYYY h:mm A')
    : 'Not set'

  const criteria = formState.resolutionCriteria?.trim()

  return (
    <Modal open={open} setOpen={setOpen} size="md">
      <Col className="bg-canvas-0 gap-4 rounded-lg p-6">
        <Row className="items-center gap-2">
          <CheckCircleIcon className="text-primary-600 h-6 w-6" aria-hidden />
          <h2 className="text-ink-900 text-xl font-semibold">
            Review your market
          </h2>
        </Row>

        <Col className="divide-ink-200 divide-y">
          <ReviewRow label="Type" value={typeLabel} />
          <ReviewRow
            label="Question"
            value={formState.question.trim() || '—'}
          />
          {criteria ? (
            <ReviewRow label="Resolves" value={criteria} />
          ) : (
            <ReviewRow
              label="Resolves"
              value="No criteria set — traders may hesitate."
              warn
            />
          )}
          {outcomeType !== 'POLL' && (
            <ReviewRow label="Closes" value={closeLabel} />
          )}
          {(outcomeType === 'MULTIPLE_CHOICE' ||
            outcomeType === 'POLL' ||
            outcomeType === 'MULTI_NUMERIC' ||
            outcomeType === 'DATE') &&
            nonEmptyAnswers.length > 0 && (
              <ReviewRow
                label={outcomeType === 'POLL' ? 'Options' : 'Answers'}
                value={`${nonEmptyAnswers.length}: ${nonEmptyAnswers
                  .slice(0, 6)
                  .join(', ')}${nonEmptyAnswers.length > 6 ? '…' : ''}`}
              />
            )}
          {outcomeType === 'PSEUDO_NUMERIC' &&
            formState.min !== undefined &&
            formState.max !== undefined && (
              <ReviewRow
                label="Range"
                value={`${formState.min} – ${formState.max}${
                  formState.unit ? ` ${formState.unit}` : ''
                }`}
              />
            )}
          <ReviewRow
            label="Settlement"
            value={useOnchain ? 'On-chain (crypto, USDC)' : 'Off-chain (free)'}
          />
          <ReviewRow
            label="Visibility"
            value={
              formState.visibility === 'public'
                ? 'Public'
                : 'Unlisted (link only)'
            }
          />
          <ReviewRow
            label="Cost"
            value={
              isFreeMarket
                ? 'Free' + (willBoost ? ` + ${formatMoney(boostCost)} boost` : '')
                : formatMoney(cost) +
                  (willBoost ? ` + ${formatMoney(boostCost)} boost` : '')
            }
          />
        </Col>

        <Row className="justify-end gap-2">
          <Button
            color="gray-outline"
            onClick={() => setOpen(false)}
            disabled={isSubmitting}
          >
            Keep editing
          </Button>
          <Button color="indigo" onClick={onConfirm} loading={isSubmitting}>
            Create market
          </Button>
        </Row>
      </Col>
    </Modal>
  )
}

function ReviewRow(props: { label: string; value: string; warn?: boolean }) {
  const { label, value, warn } = props
  return (
    <Row className="gap-3 py-2">
      <span className="text-ink-500 w-24 shrink-0 text-sm font-medium">
        {label}
      </span>
      <span
        className={
          warn
            ? 'flex-1 text-sm text-amber-600 dark:text-amber-400'
            : 'text-ink-900 flex-1 text-sm'
        }
      >
        {value}
      </span>
    </Row>
  )
}
