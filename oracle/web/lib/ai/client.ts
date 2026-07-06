// Client-side fetchers for the AI routes. These call our OWN API routes
// (same-origin) — never OpenRouter directly — so the OPENROUTER_API_KEY never
// touches the browser. Safe to import into client components.

import type {
  DraftMarket,
  DraftMarketRequest,
  ResolutionSuggestion,
  SuggestResolutionRequest,
} from './schema'

async function postJson<T>(path: string, body: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new Error('Could not reach the AI service. Check your connection.')
  }

  let data: unknown = undefined
  try {
    data = await res.json()
  } catch {
    // fall through to status-based error below
  }

  if (!res.ok) {
    const message =
      data && typeof data === 'object' && 'message' in data
        ? String((data as { message: unknown }).message)
        : 'The AI request failed. Try again.'
    throw new Error(message)
  }
  return data as T
}

export async function requestDraftMarkets(
  req: DraftMarketRequest
): Promise<DraftMarket[]> {
  const data = await postJson<{ drafts: DraftMarket[] }>(
    '/api/ai/draft-market',
    req
  )
  return data.drafts
}

export async function requestResolutionSuggestion(
  req: SuggestResolutionRequest
): Promise<ResolutionSuggestion> {
  const data = await postJson<{ suggestion: ResolutionSuggestion }>(
    '/api/ai/suggest-resolution',
    req
  )
  return data.suggestion
}
