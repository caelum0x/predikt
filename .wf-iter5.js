export const meta = {
  name: 'iterate-develop-carryforward',
  description: 'Iteration 5: close the accumulated carry-forward items — Cipher PlayScreen decomposition, Vertex branch coverage, Predikt quoteAmm+registry tests, Aether a11y gap. Disjoint apps. Verify.',
  phases: [
    { title: 'Develop' },
    { title: 'Verify' },
  ],
}

const CIPHER = '/Users/arhansubasi/expo games and apps/TheLock'
const VERTEX = '/Users/arhansubasi/expo games and apps/pillar-valley'
const WEB = '/Users/arhansubasi/expo games and apps/prediction/oracle/web'
const AETHER = '/Users/arhansubasi/expo games and apps/rn-crypto-wallet'
const ENV = `Headless: no device, disk may be tight — no heavy installs; \`npx tsc --noEmit\` + tests only if node_modules exists. REAL only (no stub/mock-in-prod, no empty tests). No secrets. Preserve behavior + GREENLIT compliance. Loop tsc + tests to green.`

phase('Develop')
log('Close carry-forward items across Cipher/Vertex/Predikt/Aether (parallel, disjoint apps).')

const cipher = () => agent(`Cipher (${CIPHER}): reduce complexity of the two oversized files flagged by audit — \`PlayScreen.tsx\` (652 lines) and \`PlayContainer.tsx\` (543 lines). CAREFULLY decompose: extract cohesive sub-components (e.g. the keypad/dial, the guess grid, the game-over popup, the hard-mode banner) and pure helpers into their own files, keeping behavior IDENTICAL. Do NOT change game logic or UX. Prefer extraction over rewrite. Add/keep unit tests for any pure helpers extracted. Target each file under ~400 lines without hurting readability. ${ENV} Output: files extracted, new line counts, tsc + full test suite result (must stay green — Cipher had 681 tests).`, { label: 'cf:cipher', phase: 'Develop', agentType: 'general-purpose' })

const vertex = () => agent(`Vertex (${VERTEX}): raise BRANCH coverage (was ~80.4%, the lowest axis) toward 85%+ by adding focused tests on the lowest-covered high-value modules (stores/slices, game-loop helpers, progression/economy, reducers, error paths). Find the low-branch files via the coverage report and target their uncovered branches with REAL assertions (no mocks-of-production). Don't add trivial tests for coverage's sake — test meaningful behavior/edge cases. ${ENV} Output: branch coverage before->after, tests added + modules, test result (was ~900 tests, keep green).`, { label: 'cf:vertex', phase: 'Develop', agentType: 'general-purpose' })

const predikt = () => agent(`Predikt web (${WEB}): close the two on-chain test gaps from iteration 2:
- Test \`lib/onchain/router.ts\` \`quoteAmm\` + its integration into \`routeBestExecution\` — mock only the RPC boundary (amm.calcBuyAmount/calcSellAmount), assert the router integrates the AMM quote and picks best execution end-to-end (both venues present, AMM-only, CLOB-only, neither).
- Test the \`getOnchainDeployment\`/registry-lookup branch of \`settlement.ts\` \`settlementOf\`/\`conditionIdOf\` by seeding the registry, so that path is exercised.
Real tests, tsc + jest green. ${ENV} Output: tests added, coverage of the previously-untested paths, tsc/jest result.`, { label: 'cf:predikt', phase: 'Develop', agentType: 'general-purpose' })

const aether = () => agent(`Aether (${AETHER}): close the a11y gap from iteration 3 — \`wallet-setup.tsx\` (~line 228) the "Got a wallet? Let's import it" secondary action uses a raw styled TouchableOpacity with no accessibilityRole/accessibilityLabel; add them (role="button", a descriptive label). Then grep the other onboarding/auth screens for any remaining raw TouchableOpacity/Pressable wrapping interactive content without a label and fix those too (icon-only especially). Don't restyle. ${ENV} Output: controls labeled (files + count), tsc result.`, { label: 'cf:aether', phase: 'Develop', agentType: 'general-purpose' })

const b1 = await parallel([cipher, vertex])
const b2 = await parallel([predikt, aether])
const done = [...b1, ...b2].filter(Boolean)

phase('Verify')
log('Verify iteration 5 carry-forward.')
const review = await agent(`Verify iteration 5 carry-forward across 4 apps. Confirm PASS/PARTIAL/FAIL:
- Cipher (${CIPHER}): PlayScreen/PlayContainer decomposed with IDENTICAL behavior, files smaller, full test suite still green (681 tests), tsc clean.
- Vertex (${VERTEX}): branch coverage raised (report before->after), tests real, suite green.
- Predikt (${WEB}): quoteAmm+routeBestExecution and settlement registry-lookup now tested (real), jest green.
- Aether (${AETHER}): wallet-setup + any other unlabeled onboarding controls now have a11y labels; tsc clean.
- No regressions anywhere, no secrets, GREENLIT intact.
Report per-app: what landed (with numbers), residual, a 0-10 quality-delta, and the top 3 for the NEXT iteration.`, { label: 'verify', phase: 'Verify', agentType: 'code-reviewer' })

return { done: done.length, review }
