// POST /api/ai/draft-market
//
// Server-side trust boundary for AI market drafting. The browser posts a
// {topic|newsText|url} body here; this route calls OpenRouter with the SERVER
// key (never exposed to the client), validates+normalizes the model output
// with zod, and returns structured drafts. The model output is never trusted
// raw — anything that fails validation is dropped.

import type { NextApiRequest, NextApiResponse } from 'next'
import {
  chatCompletion,
  OpenRouterError,
  parseJsonObject,
} from 'web/lib/ai/openrouter'
import { buildDraftMessages } from 'web/lib/ai/prompts'
import {
  draftMarketRequestSchema,
  draftMarketSchema,
  normalizeCloseTime,
  type DraftMarket,
} from 'web/lib/ai/schema'
import { getAuthedUser } from 'web/lib/ai/require-auth'
import { consumeToken } from 'web/lib/ai/rate-limit'

type SuccessBody = { drafts: DraftMarket[] }
type ErrorBody = { message: string }

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SuccessBody | ErrorBody>
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ message: 'Method not allowed.' })
  }

  // Require an authenticated user — these routes spend real OpenRouter credits.
  const user = await getAuthedUser(req)
  if (!user) {
    return res.status(401).json({ message: 'Sign in to use the AI assistant.' })
  }

  // Per-user rate limit to prevent a single signed-in caller from hammering us.
  const limit = consumeToken(`ai:draft-market:${user.uid}`)
  if (!limit.allowed) {
    res.setHeader('Retry-After', String(limit.retryAfterSeconds))
    return res.status(429).json({
      message: 'Too many AI requests. Please wait a moment and try again.',
    })
  }

  const parsedReq = draftMarketRequestSchema.safeParse(req.body)
  if (!parsedReq.success) {
    return res.status(400).json({
      message:
        parsedReq.error.issues[0]?.message ?? 'Invalid request. Add a source.',
    })
  }
  const request = parsedReq.data

  const now = new Date()
  const messages = buildDraftMessages(request, now.toISOString())

  let raw: string
  try {
    raw = await chatCompletion({ messages, jsonMode: true, temperature: 0.5 })
  } catch (err) {
    return sendAiError(res, err)
  }

  // Parse JSON, then validate each draft. Keep only well-formed drafts.
  let parsedJson: unknown
  try {
    parsedJson = parseJsonObject(raw)
  } catch (err) {
    return sendAiError(res, err)
  }

  const rawDrafts = extractRawDrafts(parsedJson)
  const drafts: DraftMarket[] = []
  for (const candidate of rawDrafts) {
    const result = draftMarketSchema.safeParse(candidate)
    if (result.success) {
      drafts.push(normalizeCloseTime(result.data, now.getTime()))
    }
  }

  if (drafts.length === 0) {
    return res.status(502).json({
      message: 'The AI did not return a usable market. Try rephrasing.',
    })
  }

  return res.status(200).json({ drafts })
}

// The model may return {drafts:[...]}, a bare array, or a single object.
function extractRawDrafts(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed
  if (parsed && typeof parsed === 'object') {
    const maybe = (parsed as { drafts?: unknown }).drafts
    if (Array.isArray(maybe)) return maybe
    return [parsed]
  }
  return []
}

function sendAiError(
  res: NextApiResponse<ErrorBody>,
  err: unknown
): void {
  if (err instanceof OpenRouterError) {
    // Map upstream 4xx to a generic 502 so we don't leak provider internals,
    // except our own 400/500 config errors.
    const status = err.status === 500 || err.status === 400 ? err.status : 502
    res.status(status).json({ message: err.message })
    return
  }
  console.error(
    'draft-market unexpected error:',
    err instanceof Error ? err.message : 'unknown error'
  )
  res.status(500).json({ message: 'Unexpected error drafting the market.' })
}
