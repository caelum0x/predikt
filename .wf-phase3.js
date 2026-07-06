export const meta = {
  name: 'predikt-phase3-market-factory',
  description: 'Phase 3: the market-supply flywheel — AI market factory (news/topic -> draft markets via OpenRouter), AI resolution assistant, and polished permissionless creation across all market types. Integrate + review.',
  phases: [
    { title: 'AIFactory' },
    { title: 'MarketTypes' },
    { title: 'Integrate' },
    { title: 'Review' },
  ],
}

const WEB = '/Users/arhansubasi/expo games and apps/prediction/oracle/web'

const RULE = `Existing Manifold Next.js app reskinned as Predikt. EDIT IN PLACE, preserve the off-chain default. Theme tokens only (canvas-*, ink-*, primary- blue, yes/teal green, no/scarlet red), icon-first, plain copy, no tech/product-name leaks. Strict TS, no \`any\`. REAL ONLY — real API calls, no mock/stub/faked drafts. FREE/OSS: AI via OpenRouter (user's key, env EXPO/NEXT PUBLIC or server env — never hardcode a key). \`npx tsc --noEmit\` in ${WEB} must be 0 errors. Don't touch common/ or backend/. Market creation uses the existing create API (createMarket / the new-contract flow already in the app).`

// ---------- Phase 1: AI market factory ----------
phase('AIFactory')
log('AI market factory: topic/news -> well-formed draft markets, + resolution assistant.')
const aiFactory = await agent(`Build the AI MARKET FACTORY in ${WEB} — the supply flywheel that lets anyone (or an operator) spin up well-formed markets at scale. This is Predikt's edge over Kalshi (which can't do permissionless creation) and Polymarket (curated).
${RULE}
- lib/ai/openrouter.ts: a small typed client for OpenRouter chat completions (base https://openrouter.ai/api/v1, model configurable via NEXT_PUBLIC_AI_MODEL default a free/cheap model like 'meta-llama/llama-3.1-8b-instruct:free'; key from server env OPENROUTER_API_KEY via a Next API route so the key is NOT exposed client-side). Real calls, robust error handling, JSON-mode output parsing.
- pages/api/ai/draft-market.ts (Next API route): given {topic|newsText|url}, calls OpenRouter and returns a structured draft: { question, description, outcomeType (BINARY|MULTIPLE_CHOICE|PSEUDO_NUMERIC), answers?, closeTime (a sensible future date), category/topicSlug, resolutionCriteria }. Validate/normalize the model output with zod; never trust it raw. Never expose the key.
- components/create/ai-market-composer.tsx: a "Create with AI" panel in the market-creation flow — user enters a topic or pastes news, gets one or more editable draft markets (question/close/category/resolution shown, all editable), then confirms to create via the app's existing create-market path. Icon-first, plain copy. Show loading/error/empty. It DRAFTS; the human confirms and the real create API does the actual creation — no auto-posting of unreviewed markets.
- pages/api/ai/suggest-resolution.ts + a small UI hook: given a market + optional sources, ask the model to propose YES/NO/answer with a cited rationale — an ASSISTANT for the resolver (never auto-resolves; on-chain resolution stays UMA, off-chain stays the creator/admin).
- docs/AI.md: what it does, the env (OPENROUTER_API_KEY server-side, NEXT_PUBLIC_AI_MODEL), cost/free-model notes, and that AI only DRAFTS/SUGGESTS (humans/UMA decide).
Output: files, the exact OpenRouter flow, how the key stays server-side, and tsc result.`, { label: 'ai-factory', phase: 'AIFactory', agentType: 'general-purpose' })

// ---------- Phase 2: market types polish ----------
phase('MarketTypes')
log('Surface + polish all market types in the create flow (permissionless, rich).')
const types = await agent(`Make Predikt's permissionless market creation rich and clean — the create flow should make all supported market types first-class (Kalshi can't offer permissionless creation; we lean into it).
${RULE}
- Audit the existing create flow (components/new-contract/* and the create page) and the outcomeTypes the backend supports (BINARY, MULTIPLE_CHOICE, PSEUDO_NUMERIC/numeric, POLL). Make each selectable with clear, plain, icon-first cards explaining it in one short line, with the right inputs per type (e.g. numeric range for PSEUDO_NUMERIC, options for MULTIPLE_CHOICE, poll options for POLL). Preserve all existing creation logic/validation.
- Add a clean "resolution criteria" field surfaced prominently (good markets need clear resolution) and the off-chain/on-chain settlement toggle already present.
- Add a lightweight PARLAY/combo affordance where feasible CLIENT-SIDE: let a user pick 2-4 existing markets into a shareable "parlay" view (combined implied odds) — if the backend has no parlay primitive, implement it as a shareable client-side bundle/view that deep-links the legs (clearly labeled, real odds from real markets), not a fake on-chain product.
- Polish: consistent Polymarket look, validation messages, review-before-submit step.
Output: files changed, the types now first-class, the parlay approach, tsc result.`, { label: 'market-types', phase: 'MarketTypes', agentType: 'general-purpose' })

// ---------- Phase 3: integrate ----------
phase('Integrate')
log('Typecheck + reconcile the create flow.')
const integrate = await agent(`Integrate Phase 3 in ${WEB}. Run \`npx tsc --noEmit\` and FIX every error from the AI factory + market-types work without removing behavior. Reconcile any overlap in the create flow (ai-market-composer + the market-type UI both feed the same create path — make them coherent). Confirm off-chain default + existing creation still work; the AI key stays server-side (no NEXT_PUBLIC_OPENROUTER_API_KEY). Output: tsc before->after, files fixed, confirmation the key is server-side only.`, { label: 'integrate', phase: 'Integrate', agentType: 'build-error-resolver' })

// ---------- Phase 4: review ----------
phase('Review')
log('Review Phase 3.')
const review = await agent(`Review Phase 3 (market factory) in ${WEB}: AI drafting uses REAL OpenRouter via a server API route with the key server-side only (grep to confirm no client-exposed key); model output is zod-validated (not trusted raw); AI only DRAFTS/SUGGESTS (no auto-create, no auto-resolve; on-chain resolution still UMA); all market types are first-class + creation logic preserved; parlay is a real (client bundle) view not a faked product; no mock/stub; theme tokens consistent; no tech-name leaks; tsc clean. Report CRITICAL/HIGH/MED/LOW + a 0-10 score + whether market supply can now scale.`, { label: 'review', phase: 'Review', agentType: 'code-reviewer' })

return { aiFactory, types, integrate, review }
