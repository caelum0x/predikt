// Hook for the resolver assistant. Asks the AI to PROPOSE a verdict for a
// market; it never resolves anything. The caller decides what to do with the
// suggestion (a human or, on-chain, UMA makes the real decision).

import { useState } from 'react'
import { requestResolutionSuggestion } from 'web/lib/ai/client'
import type {
  ResolutionSuggestion,
  SuggestResolutionRequest,
} from 'web/lib/ai/schema'

export type UseAiResolution = {
  suggestion: ResolutionSuggestion | undefined
  loading: boolean
  error: string | undefined
  suggest: (req: SuggestResolutionRequest) => Promise<void>
  reset: () => void
}

export function useAiResolution(): UseAiResolution {
  const [suggestion, setSuggestion] = useState<ResolutionSuggestion>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()

  async function suggest(req: SuggestResolutionRequest): Promise<void> {
    setLoading(true)
    setError(undefined)
    try {
      const result = await requestResolutionSuggestion(req)
      setSuggestion(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The AI request failed.')
      setSuggestion(undefined)
    } finally {
      setLoading(false)
    }
  }

  function reset(): void {
    setSuggestion(undefined)
    setError(undefined)
    setLoading(false)
  }

  return { suggestion, loading, error, suggest, reset }
}
