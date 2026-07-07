export const meta = {
  name: 'iterate-develop-predikt',
  description: 'Iteration 2: harden Predikt on-chain reliability — unit test coverage + edge-case robustness for the viem client + CPMM/AMM/router math + the relay matcher/book. Verify.',
  phases: [
    { title: 'Develop' },
    { title: 'Verify' },
  ],
}

const WEB = '/Users/arhansubasi/expo games and apps/prediction/oracle/web'
const RELAY = '/Users/arhansubasi/expo games and apps/prediction/predikt-relay'
const ENV = `Headless: no device; disk may be tight — no heavy fresh installs; run \`npx tsc --noEmit\` + \`npx jest\` only if node_modules exists, else careful typed edits. REAL tests only (assert real behavior of real functions — no mocks-of-production, no empty asserts). No secrets. Keep behavior + the off-chain default intact; don't weaken security (mnemonic never plaintext, key separate from ciphertext).`

phase('Develop')
log('Harden Predikt on-chain client + relay (tests + robustness).')

const client = () => agent(`Harden the Predikt ON-CHAIN CLIENT + pure math in the web app at ${WEB}. Add FOCUSED unit tests + edge-case guards for the modules that lack coverage:
- lib/engine/cpmm.ts (previewBet/cpmmProbability/cpmmShares/cpmmPoolAfter): test probability bounds 0..1, shares>0 monotonic in amount, payout/return math, p!=0.5, and degenerate pools (0 liquidity, tiny/huge amounts) — guard NaN/Infinity.
- lib/onchain/amm.ts + router.ts: test the best-execution router picks the venue returning more tokens (buy) / more USDC (sell); AMM calc parsing; the binary-search sell inversion; graceful 'none' when neither venue prices.
- lib/onchain/crypto.ts + storage.ts: encrypt->decrypt round-trip, wrong key fails, key never equals ciphertext, separate-store invariant (already partly tested — extend).
- lib/onchain/chains.ts + settlement.ts + market.ts helpers (derivePositionIds, settlementOf, formatting): pure-function tests + guards.
- lib/positions.ts + lib/format.ts (pct/priceCents/compact/closesIn/timeAgo): edge cases (undefined/NaN/negative/huge).
- lib/ai/schema.ts: zod validation accepts good drafts, rejects malformed, normalizes close-time.
Add real jest tests, run them green, and harden any undefined/NaN/throw paths you find. ${ENV}
Output: tests added (count + which modules), edge cases guarded, tsc/jest result.`, { label: 'predikt:client', phase: 'Develop', agentType: 'general-purpose' })

const relay = () => agent(`Harden the Predikt RELAY (CLOB operator + market maker) at ${RELAY}. Add FOCUSED unit tests + robustness for the pure/critical logic:
- src/book/matcher.ts + order.ts: price-time priority matching, crossing/taking math (making*takerAmount/makerAmount floor), partial fills, complementary-token pairing, the match lock preventing double-spend — test with crafted books.
- order validation (signature-type gate EOA-only, amount/expiry checks, idempotency on hash) and the fund-check branching (BUY=USDC bal/allowance, SELL=CTF bal/approval).
- src/marketmaker/pricing.ts (mid from book/oracle, price clamp, ladder builder) — test ladder spacing/sizing/levels + clamping.
- store/db.ts serialization round-trip + listOrdersByMaker row cap; the DB-rehydration schema validation.
Add real tests (a test runner if missing — the relay is Node/TS; use node:test or vitest/jest, whichever fits with minimal deps), run green. Harden any edge cases (empty book, self-cross, zero-size, rounding). Do NOT weaken the real on-chain settlement path (still real matchOrders, no faked fills). ${ENV}
Output: tests added, edge cases hardened, tsc/test result.`, { label: 'predikt:relay', phase: 'Develop', agentType: 'general-purpose' })

const done = (await parallel([client, relay])).filter(Boolean)

phase('Verify')
log('Verify iteration 2.')
const review = await agent(`Verify Predikt iteration 2 hardening. Confirm PASS/PARTIAL/FAIL:
- CLIENT (${WEB}/lib): new tests are REAL (assert real cpmm/amm/router/crypto/format behavior, not mocks); probability stays 0..1; router picks best execution; crypto round-trips + key-separation invariant holds; NaN/undefined guarded. tsc + jest green.
- RELAY (${RELAY}): matcher price-time + crossing math tested; order validation + fund-check tested; MM ladder tested; real matchOrders settlement path NOT weakened (no faked fills). tsc + tests green.
- No regressions, no secrets, security invariants intact.
Report per-track: tests added (count), what's now covered, residual, a 0-10 quality-delta score, and the top 3 for the NEXT iteration.`, { label: 'verify', phase: 'Verify', agentType: 'code-reviewer' })

return { done: done.length, review }
