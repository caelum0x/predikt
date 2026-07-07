export const meta = {
  name: 'iterate-develop',
  description: 'Continuous develop iteration: evaluate -> deepen/harden -> verify. This run targets Cipher + Vertex reliability (test coverage on core logic), accessibility, edge-case robustness, and error/empty-state polish.',
  phases: [
    { title: 'Develop' },
    { title: 'Verify' },
  ],
}

const APPS = {
  Cipher: '/Users/arhansubasi/expo games and apps/TheLock',
  Vertex: '/Users/arhansubasi/expo games and apps/pillar-valley',
}
const ENV = `Headless: no device/simulator, disk may be tight — no heavy fresh installs; run \`npx tsc --noEmit\` and \`npx jest\` (or the app's test script) only if node_modules exists, else careful typed edits. REAL improvements only (no stub/mock in production, no fake tests that assert nothing), no secrets, keep the app working + the brand + GREENLIT compliance intact (don't add tracking/ATT-triggering code, keep placeholder handling).`

function develop(name, path) {
  return agent(`Iterate + HARDEN "${name}" (${path}) — raise real quality without changing product scope. Do a genuine evaluate-then-improve pass across these, prioritizing the highest-value gaps you find:
1) **Test coverage** — add FOCUSED unit/integration tests for the app's core PURE logic that lacks coverage (game engine/scoring, redux slices/reducers, daily-puzzle/seed logic, progression/streaks/economy utils, formatters). Test REAL functions (no mocking production code, no empty asserts). Run the test suite to green and report the before/after count.
2) **Accessibility** — add accessibilityLabel / accessibilityRole / accessibilityHint (+ accessibilityState where relevant) to the interactive controls on the key screens (home/menu, play/game, result, settings, store/paywall, modes). Ensure icon-only buttons have labels. Don't restyle — just make it screen-reader usable.
3) **Robustness** — handle the top edge cases you find: loading/error/empty states on data-driven screens, guard against undefined/NaN in game/score math, safe fallbacks when a backend/service is unconfigured (offline-safe), and defensive handling around IAP/ads init failures (no crash).
4) **Polish** — fix any rough user-visible edges you notice (inconsistent copy, missing empty-state text) — small, safe.
${ENV}
Loop \`npx tsc --noEmit\` (+ tests) to green. Output: tests added (before->after count + coverage if available), a11y labels added (count + screens), edge cases hardened, polish fixes — with file references, and the final tsc/test result.`, { label: `${name.toLowerCase()}:develop`, phase: 'Develop', agentType: 'general-purpose' })
}

phase('Develop')
log('Iteration: harden Cipher + Vertex (tests + a11y + robustness + polish).')
const done = (await parallel([
  () => develop('Cipher', APPS.Cipher),
  () => develop('Vertex', APPS.Vertex),
])).filter(Boolean)

phase('Verify')
log('Verify the iteration.')
const review = await agent(`Verify the hardening iteration on Cipher (${APPS.Cipher}) and Vertex (${APPS.Vertex}). For EACH confirm PASS/PARTIAL/FAIL:
- Tests: new tests are REAL (assert real behavior of real functions, not mocks/empty), and the suite passes; report the test count + coverage delta.
- Accessibility: interactive controls on the key screens have labels/roles; icon-only buttons are labeled.
- Robustness: data screens handle loading/error/empty; game/score math guards undefined/NaN; unconfigured-service and IAP/ads-init failures don't crash.
- No regressions: \`tsc\` clean, no new stubs/mocks-in-prod, no secrets, GREENLIT compliance intact (no new tracking/ATT triggers).
Report per-app: what improved (with numbers), any residual, and a 0-10 "quality delta" score for this iteration + the top 3 things a NEXT iteration should tackle.`, { label: 'verify', phase: 'Verify', agentType: 'code-reviewer' })

return { done: done.length, review }
