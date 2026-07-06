// Hook for the AI market composer. Requests one or more editable market DRAFTS
// from our server route. It only drafts — the human confirms and the real
// create-market API does the actual creation.

import { useState } from 'react'
import { requestDraftMarkets } from 'web/lib/ai/client'
import type { DraftMarket, DraftMarketRequest } from 'web/lib/ai/schema'

export type UseAiDrafts = {
  drafts: DraftMarket[]
  loading: boolean
  error: string | undefined
  hasRun: boolean
  generate: (req: DraftMarketRequest) => Promise<void>
  reset: () => void
}

export function useAiDrafts(): UseAiDrafts {
  const [drafts, setDrafts] = useState<DraftMarket[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [hasRun, setHasRun] = useState(false)

  async function generate(req: DraftMarketRequest): Promise<void> {
    setLoading(true)
    setError(undefined)
    try {
      const result = await requestDraftMarkets(req)
      setDrafts(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The AI request failed.')
      setDrafts([])
    } finally {
      setLoading(false)
      setHasRun(true)
    }
  }

  function reset(): void {
    setDrafts([])
    setError(undefined)
    setLoading(false)
    setHasRun(false)
  }

  return { drafts, loading, error, hasRun, generate, reset }
}
