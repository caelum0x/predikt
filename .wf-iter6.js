export const meta = {
  name: 'iterate-develop-shipfixes',
  description: 'Iteration 6: fix real user-visible artifacts (Vertex paywall debug tag, emoji→vector glyphs, jargon), Cipher usePlaySession + component tests, Predikt coverage gate. Verify.',
  phases: [
    { title: 'Develop' },
    { title: 'Verify' },
  ],
}

const CIPHER = '/Users/arhansubasi/expo games and apps/TheLock'
const VERTEX = '/Users/arhansubasi/expo games and apps/pillar-valley'
const WEB = '/Users/arhansubasi/expo games and apps/prediction/oracle/web'
const ENV = `Headless: no device, disk may be tight — no heavy installs; \`npx tsc --noEmit\` + tests only if node_modules exists. REAL only, no secrets. Preserve behavior + GREENLIT compliance. Icon-first: prefer vector symbols over emoji in UI. Loop tsc + tests green.`

phase('Develop')
log('Fix user-visible artifacts + next coverage (Vertex/Cipher/Predikt).')

const vertex = () => agent(`Vertex (${VERTEX}) — icon-first cleanup + coverage. (NOTE: a prior review's "Offer A/B debug artifact on paywall.tsx" and "procedurally-classified jargon" were VERIFIED as FALSE POSITIVES — the paywall A/B is a legitimate copy test with no visible debug text, and the jargon string doesn't exist. Do NOT chase those; don't touch the paywall A/B logic.)
1) **Icon-first:** replace emoji glyphs with vector symbols in the shipped UI — the cosmetics catalog (src/.../Cosmetics.ts) and avatar picker (AVATAR_EMOJI in profile.ts). Use the app's existing SF Symbol/Ionicons {icon, fallback} pattern. Grep the app for other emoji in user-visible strings/labels and replace those too. No emoji in shipped UI.
2) **Coverage:** add branch tests for preferences.ts (currently 0% branch) with real assertions; while there, raise branches on any other 0%-branch store slice you find.
3) **Sweep:** grep for any genuine user-visible debug/dev artifacts (e.g. rendered variant ids, "TODO"/"DEBUG" text, test copy) and remove/gate them — but only REAL ones you can see rendered.
${ENV} Output: emoji replaced (count + files), coverage delta, any real artifact removed, tsc/test result (keep the ~945 suite green).`, { label: 'ship:vertex', phase: 'Develop', agentType: 'general-purpose' })

const cipher = () => agent(`Cipher (${CIPHER}) — continue the PlayScreen cleanup + add component tests:
1) Extract a \`usePlaySession\` hook from PlayScreen.tsx (sound loading, round hydration, resumedCode/hasHydratedRef logic) so PlayScreen drops below ~400 lines, behavior IDENTICAL.
2) Add REAL render/behavior tests for the extracted view components (GuessBoard, GuessRow, WinPopup, GameOverPopup) using @testing-library/react-native — assert prop-driven rendering + interactions.
3) If present, finish the achievement/badge emoji→vector-symbol migration (icon-first) in the achievements catalog.
${ENV} Output: hook extracted + new PlayScreen line count, component tests added, tsc/full-suite result (keep green, was 703).`, { label: 'ship:cipher', phase: 'Develop', agentType: 'general-purpose' })

const predikt = () => agent(`Predikt web (${WEB}) — add a regression GATE + expand on-chain coverage:
1) Add Jest coverage thresholds scoped to lib/onchain/ (and lib/engine, lib/ai) in the jest config — set an HONEST floor rounded down from current, so a regression fails CI. Add collectCoverageFrom for those dirs.
2) Expand assertion depth on lib/onchain/storage.ts (read/write round-trips, native-bridge vs localStorage fallback) and lib/onchain/chains.ts (chain-lookup edge cases), and add tests for any still-uncovered pure helper in lib/onchain/market.ts.
3) If ts-jest warns on the TS version, bump ts-jest to a TS-5.x-compatible range (only if it doesn't break the suite).
${ENV} Output: thresholds set (numbers), tests added, tsc/jest result.`, { label: 'ship:predikt', phase: 'Develop', agentType: 'general-purpose' })

const b1 = await parallel([vertex, cipher])
const b2 = await parallel([predikt])
const done = [...b1, ...b2].filter(Boolean)

phase('Verify')
log('Verify iteration 6.')
const review = await agent(`Verify iteration 6. Confirm PASS/PARTIAL/FAIL:
- Vertex (${VERTEX}): the "Offer A/B" debug artifact is GONE from the shipped paywall; emoji replaced with vector symbols in cosmetics + avatar; jargon fixed; preferences.ts branch tests added; suite green + tsc clean.
- Cipher (${CIPHER}): usePlaySession extracted (PlayScreen smaller), component render tests added + green, achievement emoji migration done if applicable; tsc clean.
- Predikt (${WEB}): jest coverage thresholds set (real floor), storage/chains/market coverage expanded, jest green + tsc clean.
- No regressions, no secrets, no NEW emoji/placeholder in UI, GREENLIT intact.
Report per-app: what landed (numbers), residual, 0-10 quality-delta, and top 3 for the NEXT iteration.`, { label: 'verify', phase: 'Verify', agentType: 'code-reviewer' })

return { done: done.length, review }
