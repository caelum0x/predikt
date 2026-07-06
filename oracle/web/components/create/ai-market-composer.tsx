// "Create with AI" panel for the market-creation flow.
//
// The supply flywheel: a user types a topic or pastes news, the AI returns one
// or more EDITABLE market drafts, the user tweaks them, then confirms. On
// confirm we hand the (edited) draft to the app's existing create flow via
// `/create?params=...` — the AI never posts a market itself. Nothing is
// created without a human reviewing and confirming.

import { SparklesIcon, PencilIcon } from '@heroicons/react/solid'
import {
  ArrowRightIcon,
  ExclamationCircleIcon,
  RefreshIcon,
} from '@heroicons/react/outline'
import Router from 'next/router'
import { useState } from 'react'
import { Button } from 'web/components/buttons/button'
import { Col } from 'web/components/layout/col'
import { Row } from 'web/components/layout/row'
import { ExpandingInput } from 'web/components/widgets/expanding-input'
import { Input } from 'web/components/widgets/input'
import { LoadingIndicator } from 'web/components/widgets/loading-indicator'
import { useAiDrafts } from 'web/hooks/use-ai-drafts'
import { draftToCreateUrl } from 'web/lib/ai/draft-to-create-url'
import type { DraftMarket } from 'web/lib/ai/schema'

// epoch-ms <-> <input type="datetime-local"> value (local time, no seconds)
function toLocalInputValue(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`
}

function fromLocalInputValue(value: string, fallback: number): number {
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? ms : fallback
}

const OUTCOME_LABEL: Record<DraftMarket['outcomeType'], string> = {
  BINARY: 'Yes / No',
  MULTIPLE_CHOICE: 'Multiple choice',
  PSEUDO_NUMERIC: 'Numeric',
  MULTI_NUMERIC: 'Numeric range',
  DATE: 'Date range',
}

export function AiMarketComposer() {
  const { drafts, loading, error, hasRun, generate } = useAiDrafts()
  const [topic, setTopic] = useState('')
  // Local editable copies keyed by draft index, so edits are immutable-friendly.
  const [edited, setEdited] = useState<Record<number, DraftMarket>>({})

  const canGenerate = topic.trim().length > 0 && !loading

  async function onGenerate() {
    if (!canGenerate) return
    setEdited({})
    // Treat multi-line pastes as news text; a short single line as a topic.
    const trimmed = topic.trim()
    const looksLikeNews = trimmed.length > 200 || trimmed.includes('\n')
    await generate(
      looksLikeNews ? { newsText: trimmed, count: 3 } : { topic: trimmed, count: 3 }
    )
  }

  function draftAt(i: number): DraftMarket {
    return edited[i] ?? drafts[i]
  }

  function updateDraft(i: number, patch: Partial<DraftMarket>) {
    setEdited((prev) => ({ ...prev, [i]: { ...draftAt(i), ...patch } }))
  }

  function onConfirm(i: number) {
    // Hand off to the app's real create flow — the human confirms there too.
    Router.push(draftToCreateUrl(draftAt(i)))
  }

  return (
    <Col className="gap-4">
      <Col className="gap-1.5">
        <Row className="items-center gap-2 text-lg font-semibold text-ink-900">
          <SparklesIcon className="h-5 w-5 text-primary-600" aria-hidden />
          Create with AI
        </Row>
        <p className="text-sm text-ink-600">
          Enter a topic or paste a news snippet. You&apos;ll get editable drafts
          — review, tweak, and confirm to create.
        </p>
      </Col>

      <Col className="gap-2">
        <ExpandingInput
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="e.g. Will a new model top the benchmarks this year? — or paste a news paragraph"
          rows={2}
          maxLength={8000}
          className="w-full text-sm"
        />
        <Row className="justify-end">
          <Button
            color="indigo"
            size="md"
            onClick={onGenerate}
            loading={loading}
            disabled={!canGenerate}
          >
            <SparklesIcon className="mr-1.5 h-4 w-4" aria-hidden />
            {hasRun ? 'Regenerate drafts' : 'Draft markets'}
          </Button>
        </Row>
      </Col>

      {loading && (
        <Col className="items-center gap-2 rounded-lg border border-ink-200 bg-canvas-50 py-8">
          <LoadingIndicator size="md" />
          <span className="text-sm text-ink-500">Drafting markets…</span>
        </Col>
      )}

      {!loading && error && (
        <Row className="items-start gap-2 rounded-lg border border-scarlet-300 bg-scarlet-50 p-3 text-sm text-scarlet-700">
          <ExclamationCircleIcon
            className="mt-0.5 h-5 w-5 shrink-0"
            aria-hidden
          />
          <Col className="gap-2">
            <span>{error}</span>
            <button
              type="button"
              onClick={onGenerate}
              className="inline-flex w-fit items-center gap-1 font-medium text-scarlet-700 underline"
            >
              <RefreshIcon className="h-4 w-4" aria-hidden />
              Try again
            </button>
          </Col>
        </Row>
      )}

      {!loading && !error && hasRun && drafts.length === 0 && (
        <Col className="items-center gap-1 rounded-lg border border-ink-200 bg-canvas-50 py-8 text-center">
          <span className="text-sm text-ink-600">No drafts came back.</span>
          <span className="text-xs text-ink-500">
            Try a more specific topic or paste more context.
          </span>
        </Col>
      )}

      {!loading &&
        drafts.length > 0 &&
        drafts.map((_, i) => (
          <DraftCard
            key={i}
            draft={draftAt(i)}
            onChange={(patch) => updateDraft(i, patch)}
            onConfirm={() => onConfirm(i)}
          />
        ))}
    </Col>
  )
}

function DraftCard(props: {
  draft: DraftMarket
  onChange: (patch: Partial<DraftMarket>) => void
  onConfirm: () => void
}) {
  const { draft, onChange, onConfirm } = props
  return (
    <Col className="gap-3 rounded-xl border border-ink-200 bg-canvas-0 p-4 shadow-sm">
      <Row className="items-center gap-2 text-xs font-medium text-ink-500">
        <PencilIcon className="h-3.5 w-3.5" aria-hidden />
        Draft — editable
        <span className="rounded-full bg-primary-50 px-2 py-0.5 text-primary-700">
          {OUTCOME_LABEL[draft.outcomeType]}
        </span>
      </Row>

      <Field label="Question">
        <ExpandingInput
          value={draft.question}
          onChange={(e) => onChange({ question: e.target.value })}
          rows={2}
          maxLength={240}
          className="w-full text-sm font-medium"
        />
      </Field>

      <Field label="Details">
        <ExpandingInput
          value={draft.description}
          onChange={(e) => onChange({ description: e.target.value })}
          rows={2}
          maxLength={4000}
          className="w-full text-sm"
        />
      </Field>

      {draft.outcomeType === 'MULTIPLE_CHOICE' && draft.answers && (
        <Field label="Answers">
          <Col className="gap-1.5">
            {draft.answers.map((answer, idx) => (
              <Input
                key={idx}
                value={answer}
                onChange={(e) => {
                  const next = [...(draft.answers ?? [])]
                  next[idx] = e.target.value
                  onChange({ answers: next })
                }}
                className="!h-9 w-full text-sm"
              />
            ))}
          </Col>
        </Field>
      )}

      <Row className="flex-wrap gap-3">
        <Field label="Closes" className="min-w-[14rem] flex-1">
          <Input
            type="datetime-local"
            value={toLocalInputValue(draft.closeTime)}
            onChange={(e) =>
              onChange({
                closeTime: fromLocalInputValue(e.target.value, draft.closeTime),
              })
            }
            className="!h-9 w-full text-sm"
          />
        </Field>
        <Field label="Category" className="min-w-[10rem] flex-1">
          <Input
            value={draft.category}
            onChange={(e) => onChange({ category: e.target.value })}
            className="!h-9 w-full text-sm"
          />
        </Field>
      </Row>

      {(draft.outcomeType === 'PSEUDO_NUMERIC' ||
        draft.outcomeType === 'MULTI_NUMERIC') && (
        <Row className="flex-wrap gap-3">
          <Field label="Min" className="flex-1">
            <Input
              type="number"
              value={draft.min ?? ''}
              onChange={(e) =>
                onChange({ min: e.target.value === '' ? undefined : Number(e.target.value) })
              }
              className="!h-9 w-full text-sm"
            />
          </Field>
          <Field label="Max" className="flex-1">
            <Input
              type="number"
              value={draft.max ?? ''}
              onChange={(e) =>
                onChange({ max: e.target.value === '' ? undefined : Number(e.target.value) })
              }
              className="!h-9 w-full text-sm"
            />
          </Field>
          {draft.outcomeType === 'MULTI_NUMERIC' && (
            <Field label="Unit" className="flex-1">
              <Input
                value={draft.unit ?? ''}
                onChange={(e) =>
                  onChange({ unit: e.target.value === '' ? undefined : e.target.value })
                }
                className="!h-9 w-full text-sm"
              />
            </Field>
          )}
        </Row>
      )}

      {draft.outcomeType === 'DATE' && (
        <Row className="flex-wrap gap-3">
          <Field label="Earliest date" className="flex-1">
            <Input
              type="date"
              value={draft.dateMin ?? ''}
              onChange={(e) =>
                onChange({ dateMin: e.target.value === '' ? undefined : e.target.value })
              }
              className="!h-9 w-full text-sm"
            />
          </Field>
          <Field label="Latest date" className="flex-1">
            <Input
              type="date"
              value={draft.dateMax ?? ''}
              onChange={(e) =>
                onChange({ dateMax: e.target.value === '' ? undefined : e.target.value })
              }
              className="!h-9 w-full text-sm"
            />
          </Field>
        </Row>
      )}

      <Field label="How it resolves">
        <ExpandingInput
          value={draft.resolutionCriteria}
          onChange={(e) => onChange({ resolutionCriteria: e.target.value })}
          rows={2}
          maxLength={2000}
          className="w-full text-sm"
        />
      </Field>

      <Row className="justify-end">
        <Button color="indigo" size="md" onClick={onConfirm}>
          Review &amp; create
          <ArrowRightIcon className="ml-1.5 h-4 w-4" aria-hidden />
        </Button>
      </Row>
    </Col>
  )
}

function Field(props: {
  label: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <Col className={props.className}>
      <span className="mb-1 text-xs font-medium text-ink-500">
        {props.label}
      </span>
      {props.children}
    </Col>
  )
}
