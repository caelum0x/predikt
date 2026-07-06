# AI Market Factory

The AI market factory is the supply flywheel: it lets anyone (or an operator)
spin up well-formed markets at scale, and helps resolvers reason about
outcomes. **The AI only DRAFTS and SUGGESTS. Humans — and, for on-chain
markets, UMA — make every real decision.** No market is created and no market
is resolved by the AI.

## What it does

### 1. Create with AI (drafting)

A "Create with AI" panel in the market-creation flow (`/create`). The user
types a topic or pastes a news snippet and gets one or more **editable** draft
markets, each with:

- `question`
- `description`
- `outcomeType` — `BINARY`, `MULTIPLE_CHOICE`, or `PSEUDO_NUMERIC`
- `answers` (multiple choice) / `min` + `max` (numeric)
- `closeTime` — a sensible future date
- `category` / `topicSlug`
- `resolutionCriteria`

Every field is editable. Confirming a draft hands it off to the app's
**existing** create-market flow via `/create?params=...`, so the human reviews
everything one more time and the app's own `api('market', …)` path performs the
real creation. The AI never auto-posts an unreviewed market.

### 2. Resolver assist (suggestion)

Given a market (and optional pasted sources), the AI proposes a
`YES` / `NO` / `ANSWER` / `UNCLEAR` verdict with a confidence score, a cited
rationale, and citations. This is an **assistant for the resolver only**:

- Off-chain markets are still resolved by the creator/admin.
- On-chain markets are still resolved by **UMA**.

The suggestion is advisory; it never triggers a resolution.

## How the OpenRouter key stays server-side

The browser never talks to OpenRouter and never sees the key.

```
Browser (composer / hook)
  → POST /api/ai/draft-market        (same-origin Next API route)
  → POST /api/ai/suggest-resolution
        │  reads process.env.OPENROUTER_API_KEY  (server env only)
        ▼
     OpenRouter  (https://openrouter.ai/api/v1/chat/completions)
```

- `lib/ai/openrouter.ts` is the only place the key is read
  (`process.env.OPENROUTER_API_KEY`). It is imported **only** by the API
  routes, never by client code.
- `lib/ai/client.ts` (browser) calls our own `/api/ai/*` routes, not OpenRouter.
- The key is **not** prefixed with `NEXT_PUBLIC_`, so Next never inlines it into
  the client bundle.
- Model output is validated and normalized with **zod** in the routes
  (`lib/ai/schema.ts`) before anything is returned — the model is never trusted
  raw. Malformed drafts are dropped; a bad resolution suggestion returns an
  error.

## The exact OpenRouter flow

1. Client posts `{ topic | newsText | url }` (draft) or a market description
   (resolution) to the relevant `/api/ai/*` route.
2. The route validates the request body with zod.
3. `lib/ai/prompts.ts` builds a system+user message pair instructing the model
   to return a strict JSON object.
4. `chatCompletion()` POSTs to
   `https://openrouter.ai/api/v1/chat/completions` with
   `Authorization: Bearer $OPENROUTER_API_KEY`, `response_format:
   { type: 'json_object' }`, an abort/timeout budget, and robust error
   handling (timeouts → 504, upstream failures → 502, missing key → 500).
5. `parseJsonObject()` extracts the JSON (tolerating code fences / stray prose).
6. The route validates each item against the zod schema, normalizes the close
   time to a sensible future value, and returns only well-formed results.

## Environment

| Variable | Where | Required | Notes |
| --- | --- | --- | --- |
| `OPENROUTER_API_KEY` | **server only** | yes (for AI features) | Never `NEXT_PUBLIC_`, never hardcoded. Get one at <https://openrouter.ai/keys>. |
| `NEXT_PUBLIC_AI_MODEL` | server + client | no | Model id. Defaults to `meta-llama/llama-3.1-8b-instruct:free`. |
| `OPENROUTER_SITE_URL` | server | no | Optional OpenRouter attribution (`HTTP-Referer`). Public, not a secret. |
| `OPENROUTER_SITE_NAME` | server | no | Optional OpenRouter attribution (`X-Title`). Public, not a secret. |

When `OPENROUTER_API_KEY` is unset, the AI routes return a clear
"not configured" message and the rest of the app is unaffected — the off-chain
default and manual create/resolve flows work exactly as before.

## Cost / free-model notes

- The default model (`meta-llama/llama-3.1-8b-instruct:free`) is a **free** tier
  model on OpenRouter — no per-token cost, subject to OpenRouter's free-tier
  rate limits.
- To use a stronger paid model, set `NEXT_PUBLIC_AI_MODEL` to any OpenRouter
  model id (e.g. a small instruct model). You pay OpenRouter's per-token rate;
  drafting a market is a single short completion, so cost is minimal.
- No paid SaaS is required: the feature runs entirely on OpenRouter's free tier
  with the user's own key.

## Files

- `lib/ai/openrouter.ts` — typed, server-only OpenRouter client.
- `lib/ai/schema.ts` — zod schemas + types (drafts, resolution suggestions).
- `lib/ai/prompts.ts` — prompt construction (server).
- `lib/ai/client.ts` — browser fetchers that call our own routes.
- `lib/ai/draft-to-create-url.ts` — draft → existing create-flow handoff.
- `pages/api/ai/draft-market.ts` — draft route.
- `pages/api/ai/suggest-resolution.ts` — resolver-assist route.
- `components/create/ai-market-composer.tsx` — the "Create with AI" panel.
- `hooks/use-ai-drafts.ts`, `hooks/use-ai-resolution.ts` — UI hooks.
