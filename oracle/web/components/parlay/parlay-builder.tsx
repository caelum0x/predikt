import { LinkIcon, PlusIcon, XIcon } from '@heroicons/react/solid'
import clsx from 'clsx'
import {
  BinaryContract,
  Contract,
  contractPath,
} from 'common/contract'
import { getDisplayProbability } from 'common/calculate'
import { DOMAIN } from 'common/envs/constants'
import { useCallback, useState } from 'react'
import { toast } from 'react-hot-toast'
import { Button } from 'web/components/buttons/button'
import { Col } from 'web/components/layout/col'
import { Row } from 'web/components/layout/row'
import { Input } from 'web/components/widgets/input'
import { LoadingIndicator } from 'web/components/widgets/loading-indicator'
import { searchContracts } from 'web/lib/api/api'
import { useDebouncedEffect } from 'web/hooks/use-debounced-effect'
import {
  MAX_PARLAY_LEGS,
  MIN_PARLAY_LEGS,
  ParlaySide,
  combinedParlayProbability,
  impliedMultiplier,
  parlayPath,
  sideProbability,
} from 'web/lib/parlay/parlay'

type PickedLeg = {
  contract: BinaryContract
  side: ParlaySide
}

function yesProbabilityOf(contract: BinaryContract): number {
  return getDisplayProbability(contract)
}

function formatPct(p: number): string {
  return `${Math.round(p * 100)}%`
}

// Interactive parlay builder: search real BINARY markets, pick 2–4 legs, choose
// a side per leg, see the combined implied odds, and copy a shareable deep link.
export function ParlayBuilder() {
  const [legs, setLegs] = useState<PickedLeg[]>([])
  const [term, setTerm] = useState('')
  const [results, setResults] = useState<BinaryContract[]>([])
  const [searching, setSearching] = useState(false)

  const pickedIds = new Set(legs.map((l) => l.contract.id))

  const runSearch = useCallback(async (query: string) => {
    const trimmed = query.trim()
    if (trimmed.length === 0) {
      setResults([])
      setSearching(false)
      return
    }
    setSearching(true)
    try {
      const contracts = await searchContracts({
        term: trimmed,
        contractType: 'BINARY',
        filter: 'open',
        limit: 8,
        sort: 'most-popular',
      })
      setResults((contracts ?? []).filter(isOpenBinary))
    } catch (e) {
      console.error('Error searching markets for parlay:', e)
      setResults([])
    } finally {
      setSearching(false)
    }
  }, [])

  useDebouncedEffect(() => runSearch(term), 400, [term])

  const addLeg = (contract: BinaryContract) => {
    if (legs.length >= MAX_PARLAY_LEGS) {
      toast.error(`A parlay can have at most ${MAX_PARLAY_LEGS} legs.`)
      return
    }
    if (pickedIds.has(contract.id)) return
    setLegs((prev) => [...prev, { contract, side: 'YES' }])
    setTerm('')
    setResults([])
  }

  const removeLeg = (contractId: string) => {
    setLegs((prev) => prev.filter((l) => l.contract.id !== contractId))
  }

  const setSide = (contractId: string, side: ParlaySide) => {
    setLegs((prev) =>
      prev.map((l) => (l.contract.id === contractId ? { ...l, side } : l))
    )
  }

  const legProbs = legs.map((l) =>
    sideProbability(yesProbabilityOf(l.contract), l.side)
  )
  const combined = combinedParlayProbability(legProbs)
  const multiplier = impliedMultiplier(combined)
  const enoughLegs = legs.length >= MIN_PARLAY_LEGS

  const shareUrl = enoughLegs
    ? `https://${DOMAIN}${parlayPath(
        legs.map((l) => ({ contractId: l.contract.id, side: l.side }))
      )}`
    : ''

  const copyShareLink = async () => {
    if (!shareUrl) return
    try {
      await navigator.clipboard.writeText(shareUrl)
      toast.success('Parlay link copied')
    } catch {
      toast.error('Could not copy link')
    }
  }

  return (
    <Col className="gap-6">
      {/* Picked legs + combined odds */}
      <Col className="bg-canvas-0 ring-ink-100 gap-4 rounded-lg p-4 shadow-md ring-1">
        <Row className="items-baseline justify-between">
          <h2 className="text-ink-900 text-lg font-semibold">Your parlay</h2>
          <span className="text-ink-500 text-sm">
            {legs.length}/{MAX_PARLAY_LEGS} legs
          </span>
        </Row>

        {legs.length === 0 ? (
          <div className="text-ink-400 border-ink-200 rounded-lg border-2 border-dashed p-6 text-center text-sm">
            Add {MIN_PARLAY_LEGS}–{MAX_PARLAY_LEGS} markets below to build a parlay.
          </div>
        ) : (
          <Col className="gap-2">
            {legs.map((leg) => (
              <LegRow
                key={leg.contract.id}
                leg={leg}
                onRemove={() => removeLeg(leg.contract.id)}
                onSetSide={(side) => setSide(leg.contract.id, side)}
              />
            ))}
          </Col>
        )}

        {enoughLegs && (
          <Col className="bg-primary-50 gap-1 rounded-lg p-4 text-center">
            <span className="text-primary-700 text-3xl font-bold">
              {formatPct(combined)}
            </span>
            <span className="text-ink-600 text-sm">
              combined chance all {legs.length} hit · pays ~
              {multiplier.toFixed(1)}x
            </span>
            <span className="text-ink-400 text-xs">
              Implied from live market odds, assuming legs are independent.
            </span>
          </Col>
        )}

        {enoughLegs && (
          <Row className="justify-end gap-2">
            <Button color="indigo" onClick={copyShareLink}>
              <LinkIcon className="mr-1.5 h-4 w-4" aria-hidden />
              Copy share link
            </Button>
          </Row>
        )}
      </Col>

      {/* Search + add markets */}
      {legs.length < MAX_PARLAY_LEGS && (
        <Col className="gap-3">
          <span className="text-ink-700 text-sm font-semibold">
            Add a market
          </span>
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search yes/no markets…"
            className="w-full"
          />
          {searching && (
            <Row className="text-ink-500 items-center gap-2 text-sm">
              <LoadingIndicator size="sm" /> Searching…
            </Row>
          )}
          <Col className="gap-2">
            {results
              .filter((c) => !pickedIds.has(c.id))
              .map((contract) => (
                <SearchResultRow
                  key={contract.id}
                  contract={contract}
                  onAdd={() => addLeg(contract)}
                />
              ))}
          </Col>
        </Col>
      )}
    </Col>
  )
}

function isOpenBinary(contract: Contract): contract is BinaryContract {
  return (
    contract.outcomeType === 'BINARY' &&
    !contract.isResolved &&
    contract.mechanism === 'cpmm-1'
  )
}

function LegRow(props: {
  leg: PickedLeg
  onRemove: () => void
  onSetSide: (side: ParlaySide) => void
}) {
  const { leg, onRemove, onSetSide } = props
  const yesProb = yesProbabilityOf(leg.contract)
  const legProb = sideProbability(yesProb, leg.side)

  return (
    <Row className="bg-canvas-0 border-ink-200 items-center gap-3 rounded-lg border p-3">
      <span className="text-ink-700 min-w-[3rem] text-lg font-semibold">
        {formatPct(legProb)}
      </span>
      <a
        href={contractPath(leg.contract)}
        target="_blank"
        rel="noopener noreferrer"
        className="text-ink-900 hover:text-primary-600 min-w-0 flex-1 truncate text-sm font-medium"
      >
        {leg.contract.question}
      </a>
      <Row className="bg-ink-100 shrink-0 rounded-lg p-1">
        <button
          onClick={() => onSetSide('YES')}
          className={clsx(
            'rounded-md px-2.5 py-1 text-xs font-semibold transition-colors',
            leg.side === 'YES'
              ? 'bg-teal-500 text-white'
              : 'text-ink-600 hover:text-ink-900'
          )}
        >
          YES
        </button>
        <button
          onClick={() => onSetSide('NO')}
          className={clsx(
            'rounded-md px-2.5 py-1 text-xs font-semibold transition-colors',
            leg.side === 'NO'
              ? 'bg-scarlet-500 text-white'
              : 'text-ink-600 hover:text-ink-900'
          )}
        >
          NO
        </button>
      </Row>
      <button
        onClick={onRemove}
        className="hover:bg-canvas-50 border-ink-300 text-ink-700 bg-canvas-0 shrink-0 rounded-full border p-1 shadow-sm"
        aria-label="Remove leg"
      >
        <XIcon className="h-4 w-4" aria-hidden />
      </button>
    </Row>
  )
}

function SearchResultRow(props: {
  contract: BinaryContract
  onAdd: () => void
}) {
  const { contract, onAdd } = props
  const yesProb = yesProbabilityOf(contract)
  return (
    <Row className="bg-canvas-0 border-ink-200 hover:border-primary-300 items-center gap-3 rounded-lg border p-3 transition-colors">
      <span className="text-ink-500 min-w-[3rem] text-sm font-semibold">
        {formatPct(yesProb)}
      </span>
      <span className="text-ink-900 min-w-0 flex-1 truncate text-sm">
        {contract.question}
      </span>
      <Button color="indigo-outline" size="xs" onClick={onAdd}>
        <PlusIcon className="mr-1 h-4 w-4" aria-hidden />
        Add
      </Button>
    </Row>
  )
}
