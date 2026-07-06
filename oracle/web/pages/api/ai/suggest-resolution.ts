// POST /api/ai/suggest-resolution
//
// Server-side trust boundary for the resolver assistant. Given a market (and
// optional sources), it asks OpenRouter for a proposed verdict + cited
// rationale. This ONLY SUGGESTS — it never resolves anything. Off-chain
// resolution stays with the creator/admin; on-chain resolution stays with UMA.
//
// The SERVER key is used here and never exposed to the client. Model output is
// validated with zod before being returned.

import type { NextApiRequest, NextApiResponse } from 'next'
import {
  chatCompletion,
  OpenRouterError,
  parseJsonObject,
} from 'web/lib/ai/openrouter'
import { buildResolutionMessages } from 'web/lib/ai/prompts'
import {
  resolutionSuggestionSchema,
  suggestResolutionRequestSchema,
  type ResolutionSuggestion,
} from 'web/lib/ai/schema'
import { getAuthedUser } from 'web/lib/ai/require-auth'
import { consumeToken } from 'web/lib/ai/rate-limit'

type SuccessBody = { suggestion: ResolutionSuggestion }
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
  const limit = consumeToken(`ai:suggest-resolution:${user.uid}`)
  if (!limit.allowed) {
    res.setHeader('Retry-After', String(limit.retryAfterSeconds))
    return res.status(429).json({
      message: 'Too many AI requests. Please wait a moment and try again.',
    })
  }

  const parsedReq = suggestResolutionRequestSchema.safeParse(req.body)
  if (!parsedReq.success) {
    return res.status(400).json({
      message: parsedReq.error.issues[0]?.message ?? 'Invalid request.',
    })
  }

  const now = new Date()
  const messages = buildResolutionMessages(parsedReq.data, now.toISOString())

  let raw: string
  try {
    raw = await chatCompletion({ messages, jsonMode: true, temperature: 0.2 })
  } catch (err) {
    return sendAiError(res, err)
  }

  let parsedJson: unknown
  try {
    parsedJson = parseJsonObject(raw)
  } catch (err) {
    return sendAiError(res, err)
  }

  const result = resolutionSuggestionSchema.safeParse(parsedJson)
  if (!result.success) {
    return res.status(502).json({
      message: 'The AI returned an unusable suggestion. Try again.',
    })
  }

  return res.status(200).json({ suggestion: result.data })
}

function sendAiError(res: NextApiResponse<ErrorBody>, err: unknown): void {
  if (err instanceof OpenRouterError) {
    const status = err.status === 500 || err.status === 400 ? err.status : 502
    res.status(status).json({ message: err.message })
    return
  }
  console.error(
    'suggest-resolution unexpected error:',
    err instanceof Error ? err.message : 'unknown error'
  )
  res.status(500).json({ message: 'Unexpected error suggesting a resolution.' })
}
