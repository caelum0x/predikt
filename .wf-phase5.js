export const meta = {
  name: 'predikt-phase5-trust-regulatory',
  description: 'Phase 5: the trust + regulatory moat — surface UMA trustless resolution status on-chain, jurisdiction-aware money-mode routing (play vs on-chain), and a verifiable/transparency panel. Integrate + review.',
  phases: [
    { title: 'Trust' },
    { title: 'Compliance' },
    { title: 'Integrate' },
    { title: 'Review' },
  ],
}

const WEB = '/Users/arhansubasi/expo games and apps/prediction/oracle/web'

const RULE = `Existing Manifold Next.js app reskinned as Predikt. EDIT IN PLACE, preserve off-chain default + existing logic. Theme tokens only (canvas-*, ink-*, primary- blue, yes/teal green, no/scarlet red), icon-first, plain copy, no tech/product-name leaks. Strict TS, no \`any\`. REAL ONLY — real on-chain reads via viem, no mock/faked status. FREE/OSS. \`npx tsc --noEmit\` in ${WEB} must be 0 errors. Don't touch common/ or backend/. Reuse lib/onchain/* (addresses, evmClient, market.ts, the UmaCtfAdapter ABI). This is NOT legal advice — the jurisdiction layer is a soft, configurable compliance aid, clearly labeled.`

// ---------- Phase 1: trust surfacing (UMA) ----------
phase('Trust')
log('Surface trustless UMA resolution status + verifiable transparency on on-chain markets.')
const trust = await agent(`Surface the TRUSTLESS RESOLUTION story on on-chain markets in ${WEB} — the credibly-neutral edge over Kalshi's centralized settlement.
${RULE}
- lib/onchain/resolution.ts: viem reads against the UmaCtfAdapter (ABI already in lib/onchain/abi) for a market's question state: initialized?, request/propose timestamps, proposed price / expected payouts (getExpectedPayouts where available), resolved?, and the dispute/liveness window. Derive a plain status: "Pending", "Proposed — dispute window open (Xh left)", "Disputed", "Resolved". Real reads only; graceful when a market isn't on-chain.
- components/onchain/resolution-status.tsx: a compact, plain, icon-first badge/panel on the on-chain market page showing that status + one plain line ("Settled trustlessly by an optimistic oracle — anyone can dispute") + a "verify on-chain" link (explorer URL for the condition/adapter, from chain config). No jargon like "UMA"/"oracle-adapter" in the visible copy — say it plainly.
- components/onchain/transparency-panel.tsx: for on-chain markets, show the on-chain facts — condition id (short), collateral (USDC), settlement is on-chain + immutable, explorer links. Real addresses from lib/onchain.
Output: files, the exact viem reads, the plain status mapping.`, { label: 'trust', phase: 'Trust', agentType: 'general-purpose' })

// ---------- Phase 2: jurisdiction-aware money-mode ----------
phase('Compliance')
log('Jurisdiction-aware money-mode routing (play vs on-chain), clearly a soft aid.')
const compliance = await agent(`Build a JURISDICTION-AWARE money-mode layer in ${WEB}: default users to the appropriate mode (free play money vs on-chain crypto) for their region — the regulatory-arbitrage edge (play money is safe where crypto/betting is restricted; on-chain where it's allowed). This is a SOFT, configurable compliance aid, NOT legal advice — label it clearly.
${RULE}
- lib/compliance/jurisdiction.ts: determine an allowed-modes signal { playMoney: boolean, onChain: boolean, region } from a real geo signal — use the Next edge/middleware geo (Vercel/CDN geo header) if present, else a configurable allowlist/blocklist from env (NEXT_PUBLIC_ONCHAIN_BLOCKED_REGIONS), defaulting to play-money-allowed everywhere and on-chain allowed unless the region is blocked. Typed, pure, testable. Include a clear "this is not legal advice; operators must configure per their counsel" doc comment.
- web/middleware.ts (extend the existing one): read the geo header, set a region header the app can consume. Don't break the existing nonce/CSP logic.
- Wire it: when on-chain is not allowed for the region, hide/disable the on-chain trade path and default to play money, with a short plain explainer ("Crypto trading isn't available in your area — play free instead"). When allowed, unchanged. A settings toggle to see/switch modes where both are allowed.
- Keep the off-chain play-money experience fully working everywhere (it's the safe default).
Output: files, the geo signal source, the default/allow/block logic, and how the UI gates on-chain.`, { label: 'compliance', phase: 'Compliance', agentType: 'general-purpose' })

// ---------- Phase 3: integrate ----------
phase('Integrate')
log('Typecheck + reconcile.')
const integrate = await agent(`Integrate Phase 5 in ${WEB}. Run \`npx tsc --noEmit\` and FIX every error from the trust + jurisdiction work without removing behavior. Ensure the middleware changes don't break the existing CSP/nonce logic. Confirm: play-money default works everywhere; on-chain UI is correctly gated by both isOnchainEnabled() AND the jurisdiction allow; resolution/transparency reads are real viem (no fake). Output: tsc before->after, files fixed, confirmation middleware CSP still intact.`, { label: 'integrate', phase: 'Integrate', agentType: 'build-error-resolver' })

// ---------- Phase 4: review ----------
phase('Review')
log('Review Phase 5.')
const review = await agent(`Review Phase 5 in ${WEB}: resolution-status + transparency use REAL viem reads of the on-chain resolution state (no faked status), plain copy (no jargon/tech-name leaks); the jurisdiction layer is a clearly-labeled soft aid (not presented as legal compliance), defaults to play-money-everywhere, gates on-chain sensibly, and NEVER blocks the free play-money default; middleware CSP/nonce still intact; tsc clean; no secrets. Report CRITICAL/HIGH/MED/LOW + a 0-10 score + whether the trust + regulatory-arbitrage story is real and safe.`, { label: 'review', phase: 'Review', agentType: 'code-reviewer' })

return { trust, compliance, integrate, review }
