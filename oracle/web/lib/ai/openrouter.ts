// Small typed client for OpenRouter chat completions.
//
// SERVER-ONLY. This module reads OPENROUTER_API_KEY from the server
// environment and MUST never be imported into client bundles. It is used by
// the Next API routes under pages/api/ai/*, which act as the trust boundary:
// the browser talks to our own routes, and only the server talks to
// OpenRouter with the key. The key is never sent to, or exposed in, the
// client.

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

// A free/cheap default. Overridable at deploy time. We read NEXT_PUBLIC_ so the
// same model id can be surfaced to the UI for display, but the model choice is
// only ever *used* here on the server.
export const DEFAULT_AI_MODEL =
  process.env.NEXT_PUBLIC_AI_MODEL || 'meta-llama/llama-3.1-8b-instruct:free'

export type ChatRole = 'system' | 'user' | 'assistant'

export type ChatMessage = {
  role: ChatRole
  content: string
}

export type ChatCompletionOptions = {
  messages: ChatMessage[]
  model?: string
  temperature?: number
  maxTokens?: number
  // When true, ask the model to return a single JSON object.
  jsonMode?: boolean
  // Abort/timeout budget in milliseconds.
  timeoutMs?: number
}

export class OpenRouterError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'OpenRouterError'
    this.status = status
  }
}

type OpenRouterChoice = {
  message?: { role?: string; content?: string | null }
  finish_reason?: string
}

type OpenRouterResponse = {
  choices?: OpenRouterChoice[]
  error?: { message?: string }
}

function requireApiKey(): string {
  const key = process.env.OPENROUTER_API_KEY
  if (!key || key.trim().length === 0) {
    throw new OpenRouterError(
      'AI is not configured on the server. Set OPENROUTER_API_KEY.',
      500
    )
  }
  return key
}

// Optional attribution headers recommended by OpenRouter. These are safe to
// send and contain no secrets.
function attributionHeaders(): Record<string, string> {
  const headers: Record<string, string> = {}
  const referer = process.env.OPENROUTER_SITE_URL
  const title = process.env.OPENROUTER_SITE_NAME
  if (referer) headers['HTTP-Referer'] = referer
  if (title) headers['X-Title'] = title
  return headers
}

/**
 * Calls OpenRouter's chat/completions endpoint and returns the assistant's
 * text content. Throws OpenRouterError with a useful status/message on any
 * failure. Never returns partial/undefined content silently.
 */
export async function chatCompletion(
  options: ChatCompletionOptions
): Promise<string> {
  const apiKey = requireApiKey()
  const {
    messages,
    model = DEFAULT_AI_MODEL,
    temperature = 0.4,
    maxTokens = 1200,
    jsonMode = false,
    timeoutMs = 45_000,
  } = options

  if (!messages || messages.length === 0) {
    throw new OpenRouterError('No prompt messages provided.', 400)
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  let res: Response
  try {
    res = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...attributionHeaders(),
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: controller.signal,
    })
  } catch (err) {
    clearTimeout(timeout)
    const message =
      err instanceof Error && err.name === 'AbortError'
        ? 'The AI request timed out. Try again.'
        : 'Could not reach the AI service. Try again.'
    throw new OpenRouterError(message, 504)
  }
  clearTimeout(timeout)

  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`
    try {
      const body = (await res.json()) as OpenRouterResponse
      if (body?.error?.message) detail = body.error.message
    } catch {
      // response body was not JSON; keep the status text
    }
    throw new OpenRouterError(`AI request failed: ${detail}`, res.status)
  }

  let data: OpenRouterResponse
  try {
    data = (await res.json()) as OpenRouterResponse
  } catch {
    throw new OpenRouterError('AI returned an unreadable response.', 502)
  }

  const content = data.choices?.[0]?.message?.content
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new OpenRouterError('AI returned an empty response.', 502)
  }
  return content
}

/**
 * Extracts a JSON object from a model response. Models sometimes wrap JSON in
 * prose or ```json fences even in JSON mode; this pulls out the first balanced
 * object and parses it. Throws OpenRouterError if no valid JSON is found.
 */
export function parseJsonObject(raw: string): unknown {
  const trimmed = raw.trim()

  // Strip a ```json ... ``` or ``` ... ``` fence if present.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1].trim() : trimmed

  const tryParse = (text: string): unknown | undefined => {
    try {
      return JSON.parse(text)
    } catch {
      return undefined
    }
  }

  const direct = tryParse(candidate)
  if (direct !== undefined) return direct

  // Fall back to the first balanced { ... } span.
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start !== -1 && end > start) {
    const span = candidate.slice(start, end + 1)
    const parsed = tryParse(span)
    if (parsed !== undefined) return parsed
  }

  throw new OpenRouterError('AI did not return valid JSON.', 502)
}
