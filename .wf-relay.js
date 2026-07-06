export const meta = {
  name: 'predikt-onchain-orderbook',
  description: 'Absorb the OSS (Polymarket contracts + clob-client) as Predikt own code (rebrand/integrate/modify), then build real single-side on-chain trading: CLOB relay operator matching EIP-712 orders via CTFExchange + client order-signing + order-book UI + CSP. Review.',
  phases: [
    { title: 'Integrate' },
    { title: 'Relay' },
    { title: 'Client' },
    { title: 'Harden' },
    { title: 'Review' },
  ],
}

const WEB = '/Users/arhansubasi/expo games and apps/prediction/oracle/web'
const CONTRACTS = '/Users/arhansubasi/expo games and apps/prediction/predikt-contracts'
const RELAY = '/Users/arhansubasi/expo games and apps/prediction/predikt-relay'
const EXCHANGE = '/Users/arhansubasi/expo games and apps/prediction/predikt-contracts/ctf-exchange'
const UMA = '/Users/arhansubasi/expo games and apps/prediction/predikt-contracts/uma-ctf-adapter'
const CLOB = '/Users/arhansubasi/expo games and apps/prediction/predikt-contracts/clob-client'

const OWN = `THESE OSS ARE NOW PREDIKT'S OWN CODE (their nested .git is removed — they live in our tree). USE ALL, TOUCH ALL — nothing stays untouched/pristine:
- ${EXCHANGE} (Polymarket CTFExchange — trading), ${UMA} (UmaCtfAdapter — trustless UMA settlement), ${CLOB} (clob-client — order building/signing). All MIT.
- MODIFY / integrate / rebrand / customize them freely as Predikt code. Do NOT keep them as read-only "vendored" clones and do NOT build a wrapper AROUND an unchanged repo.
- The ONLY hard constraint: keep the on-chain settlement/trading LOGIC correct — after any Solidity change, \`forge build\` + \`forge test\` MUST stay green (they pass now: uma-ctf-adapter 61+ tests). Prefer surface/branding/packaging/integration changes; change contract logic only where it adds real value and re-test.
- REAL ONLY: real EIP-712 orders, real on-chain matchOrders/fillOrder txs, no mock/faked fills. No secrets committed. Disk is tight (~1.8Gi) — keep new deps minimal.`

// ---------- Phase 1: Absorb + rebrand the OSS as ours ----------
phase('Integrate')
log('Make the OSS Predikt own: rebrand + integrate + keep forge tests green.')
const integrateOss = await agent(`Absorb the OSS contracts + SDK into Predikt as first-class code.
${OWN}
Tasks:
1) Contracts (${CONTRACTS}): make uma-ctf-adapter + ctf-exchange feel like ONE Predikt Foundry workspace. Rebrand the SURFACE to Predikt — package.json name/description, foundry.toml profile name, README/NatSpec headers/comments, and any user-facing "Polymarket" strings in non-critical spots — WITHOUT changing audited logic or the EIP-712 domain/signature scheme the deployed contracts rely on. Keep each repo's own deploy scripts working. Run \`forge build\` in each and \`forge test\` in uma-ctf-adapter; both MUST stay green (report results). If a shared remappings/workspace setup helps them build together, add it.
2) clob-client (${CLOB}): make it a Predikt package — rename package.json to something like @predikt/orders, update README, and keep its real order-builder/order-utils/signing (the EIP-712 typed data MUST still match the CTFExchange). Trim anything Predikt won't use (e.g. hosted-CLOB HTTP client bits) if it reduces weight, but KEEP the order construction + signing utilities intact + building (run \`npx tsc\`/its build if quick).
3) Write ${CONTRACTS}/README.md: this is Predikt's on-chain layer (settlement = UmaCtfAdapter/UMA, trading = CTFExchange, orders = the @predikt/orders SDK), all now our code, MIT, with how it fits together.
Output: what you rebranded/changed per repo, forge build+test results, and confirmation the EIP-712 order scheme + settlement logic are unchanged/correct.`, { label: 'integrate-oss', phase: 'Integrate', agentType: 'general-purpose' })

// ---------- Phase 2: Relay operator ----------
phase('Relay')
log('Build the CLOB relay operator that matches signed orders via the (now ours) CTFExchange.')
const relay = await agent(`Build the Predikt CLOB RELAY OPERATOR — a real Node/TypeScript service at ${RELAY}: the off-chain order book + on-chain matcher (Polymarket runs this privately; on-chain settlement is our CTFExchange).
${OWN}
Requirements:
- Node + TS + a minimal HTTP framework (express/fastify) + viem. package.json, tsconfig, .env.example (no secrets). Persist orders in SQLite (better-sqlite3) or a durable store (real persistence). Depend on the Predikt @predikt/orders package (from ${CLOB}) for order types/hashing where useful.
- REST API: POST /orders (accept a signed EIP-712 order — validate signature + hash against the CTFExchange EIP-712 domain; verify maker USDC/CTF balance+allowance via viem before accepting), DELETE /orders/:hash (maker-authenticated cancel), GET /book?tokenId=, GET /orders?maker=, GET /trades?tokenId=, GET /health.
- MATCHING: real price-time-priority matcher. On a marketable order, match against best resting opposite orders and submit the REAL on-chain tx as OPERATOR — matchOrders(taker, makers[], takerFill, makerFills[]) for a crossed book, fillOrder for a single maker. Compute fills per the exchange OrderStructs/Trading semantics (maker/taker ratios, partial fills, fees, tick size). Update order status from OrderFilled events. Never fabricate an un-executed fill.
- Operator wallet: viem walletClient from env OPERATOR_PK holding the exchange operator role; exchange+CTF+USDC+chain+RPC from env. Document that the deployer grants this address the operator role (addOperator).
- Safety: reject invalid-signature/insufficient-balance orders; idempotent on order hash; rate-limit submit; structured logging (never log PK/secrets); input validation (no injection).
- README.md: architecture, endpoints, env, run steps, relation to CTFExchange + @predikt/orders. Run \`npx tsc --noEmit\`.
Output: files, the exact real contract calls the matcher makes, validation + matching logic, run steps.`, { label: 'relay', phase: 'Relay', agentType: 'general-purpose' })

// ---------- Phase 3: Client order-signing + book UI ----------
phase('Client')
log('Client order-signing (via our @predikt/orders) + relay + single-side trade box + order book.')
const client = await agent(`Wire REAL single-side on-chain trading into the Predikt web app ${WEB}, using our @predikt/orders SDK (from ${CLOB}) for order signing and the Predikt relay for the book/matching.
${OWN}
- ${WEB}/lib/onchain/orders.ts: build + EIP-712 SIGN a CTFExchange order with the in-app wallet (lib/onchain/wallet.ts) using our @predikt/orders order-builder/signing typed data (must match the deployed exchange domain). Functions: buildBuyOrder/buildSellOrder (single side, market or limit), signOrder, submit to relay (POST /orders), cancel, read book/orders/trades. Relay base URL from NEXT_PUBLIC_ONCHAIN_RELAY_URL.
- Update ${WEB}/components/onchain/onchain-trade-box.tsx: real Polymarket-style box for on-chain markets — YES/NO segmented, MARKET buy/sell (sign + submit to relay, fills against resting liquidity), LIMIT option (price in cents), live payout/avg-price, existing mint/merge/redeem under "Advanced", wallet USDC balance + live position. Real signing + relay only; if relay/env absent, fall back to mint/merge/redeem (never fake a market fill).
- Add a compact ORDER BOOK panel on the on-chain market page (bid/ask depth from GET /book, recent trades from GET /trades), graceful empty state.
- Off-chain play-money path + all off-chain markets UNCHANGED.
Run \`npx tsc --noEmit\` in ${WEB}. Output: files, the signed-order + relay flow per button, confirmation off-chain untouched.`, { label: 'client-orders', phase: 'Client', agentType: 'general-purpose' })

// ---------- Phase 4: Harden ----------
phase('Harden')
log('CSP nonces + typecheck everything.')
const harden = await agent(`In the web app ${WEB}:
1) Tighten the CSP in web/next.config.js from 'unsafe-inline'/'unsafe-eval' toward nonce/hash-based, still working with Next.js pages router: add web/middleware.ts issuing a per-request nonce + injecting it into the CSP; use hashes for known inline scripts (init-theme.js) if needed; document exactly what remains and why. Keep X-Frame-Options: DENY, X-Content-Type-Options: nosniff, Referrer-Policy.
2) Run \`npx tsc --noEmit\` across the web app and FIX every error from the order/relay client work WITHOUT removing behavior; reconcile drift between lib/onchain/orders.ts, the trade box, and lib/onchain/*. Confirm off-chain path compiles + is default.
Output: CSP approach + residual, tsc before->after, files fixed.`, { label: 'harden', phase: 'Harden', agentType: 'build-error-resolver' })

// ---------- Phase 5: Review ----------
phase('Review')
log('Security review of relay + order-signing + the modified OSS.')
const review = await agent(`SECURITY review Predikt's on-chain order system + the now-integrated OSS.
- OSS integration: confirm any edits to the contracts kept the settlement/trading logic + EIP-712 domain correct — \`forge test\` in ${UMA} still green; the order typed-data in @predikt/orders (${CLOB}) still matches the CTFExchange hashOrder scheme.
- Relay (${RELAY}): signature+hash verified against the real CTFExchange EIP-712 domain (no bypass); maker balance/allowance checked; matcher submits REAL matchOrders/fillOrder, never fabricates fills; operator PK only from env, never logged; cancel maker-authenticated; input validated; rate-limited.
- Client (${WEB}/lib/onchain/orders.ts + trade box): orders signed by the user's wallet with correct typed data; no funds moved without a signed order; relay URL from env; graceful non-faked fallback when relay absent. Off-chain play-money path intact + default.
Report CRITICAL/HIGH/MED/LOW with file:line + a 0-10 score + a testnet go/no-go for on-chain order trading + whether any contract edit risked the audited logic.`, { label: 'review', phase: 'Review', agentType: 'security-reviewer' })

return { integrateOss, relay, client, harden, review }
