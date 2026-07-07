export const meta = {
  name: 'iterate-predikt-trade-ux',
  description: 'Iteration 10 (tightly scoped): Predikt on-chain trade UX — optimistic bet submission + on-chain refresh debounce + feed-list windowing. Real UX/perf, no scope creep. Verify.',
  phases: [
    { title: 'Develop' },
    { title: 'Verify' },
  ],
}

const WEB = '/Users/arhansubasi/expo games and apps/prediction/oracle/web'
const ENV = `Headless: \`npx tsc --noEmit\` + \`npx jest\` if node_modules exists. REAL only, no secrets, GREENLIT + off-chain default intact. STAY TIGHTLY SCOPED to the two files/areas named — do NOT refactor unrelated screens, add new features, or touch files outside the stated scope (no scope creep). Behavior-preserving except the specific UX improvement described; keep tests green.`

phase('Develop')
log('Predikt on-chain trade UX + feed windowing (tightly scoped).')

const trade = () => agent(`Predikt web (${WEB}) — improve the ON-CHAIN TRADE UX, scoped to the trade box + its wallet hook ONLY:
1) **Optimistic submission:** in components/onchain/onchain-trade-box.tsx, when a user submits a buy/sell/redeem, show an immediate optimistic pending state (button -> "Confirming…", disable, show the intended position delta) instead of a frozen UI while the RPC/relay confirms; reconcile to the real result on success/error (revert + surface error on failure). Do NOT fake success — the on-chain tx is still real; this is purely the UI feedback while it's in flight.
2) **Refresh debounce:** in hooks/use-onchain-wallet.ts (and its consumer in the trade box), the balance/position \`refresh\` is triggered on effect/render more than needed — debounce or interval-guard it so it doesn't fire redundant RPC calls (e.g. coalesce to at most once per N seconds + on explicit action), without breaking the mount-guard fix from iteration 9.
Keep it to these two files (+ a small shared helper if truly needed). ${ENV}
Output: the optimistic flow (states + reconcile), the debounce approach, tsc/jest result.`, { label: 'i10:trade', phase: 'Develop', agentType: 'general-purpose' })

const feed = () => agent(`Predikt web (${WEB}) — add LIST WINDOWING to the long contract/market feed(s) for perf, scoped to the feed list rendering ONLY:
- Find the main browse/feed list(s) that render potentially long lists of contract cards (e.g. components/contract/contracts-list*.tsx / feed components / the browse page list). If they render all items at once, add windowing/virtualization (react-window, or the app's existing virtualization pattern, or IntersectionObserver-based incremental render) so only visible cards mount. Preserve infinite-scroll/pagination behavior and keys.
- Do NOT change card content or unrelated components. If the list is ALREADY virtualized/paginated well, say so honestly and make no change.
${ENV}
Output: what list(s) were windowed (or confirmed already-virtualized), the approach, tsc/jest result.`, { label: 'i10:feed', phase: 'Develop', agentType: 'general-purpose' })

const done = (await parallel([trade, feed])).filter(Boolean)

phase('Verify')
log('Verify iteration 10.')
const review = await agent(`Verify iteration 10 (Predikt trade UX + feed windowing) at ${WEB}. Confirm PASS/PARTIAL/FAIL:
- Optimistic submission: the trade box shows an immediate pending state + reconciles to real result; the on-chain tx is STILL real (no faked success); errors revert + surface. Scoped to trade-box + wallet hook.
- Refresh debounce: redundant RPC refreshes reduced; mount-guard from iter 9 intact.
- Feed windowing: long list(s) virtualized (or honestly confirmed already-good); pagination/keys preserved.
- SCOPE: changes confined to the named areas — flag any scope creep into unrelated files.
- No regressions: tsc clean, jest green, no secrets, GREENLIT + off-chain default intact.
Report per-item: what landed, scope adherence, residual, a 0-10 quality-delta, and whether Predikt is now at plateau (be honest).`, { label: 'verify', phase: 'Verify', agentType: 'code-reviewer' })

return { done: done.length, review }
