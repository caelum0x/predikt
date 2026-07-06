export const meta = {
  name: 'predikt-onchain-polish-oss',
  description: 'Predikt: Polymarket polish + wire the app DIRECTLY to the real Polymarket contracts (uma-ctf-adapter + ctf-exchange, deployed via their OWN scripts) with a viem client + liquify OSS. No custom contracts. Integrate + review.',
  phases: [
    { title: 'Polish' },
    { title: 'Client' },
    { title: 'Deploy-Doc' },
    { title: 'OSS' },
    { title: 'Integrate' },
    { title: 'Review' },
  ],
}

const WEB = '/Users/arhansubasi/expo games and apps/prediction/oracle/web'
const PRED = '/Users/arhansubasi/expo games and apps/prediction'
const CONTRACTS = '/Users/arhansubasi/expo games and apps/prediction/predikt-contracts'
const WALLET = '/Users/arhansubasi/expo games and apps/rn-crypto-wallet/src'

const HARD = `HARD RULES (Manifold Next.js app, MIT — brand "Predikt"):
- EDIT IN PLACE; no new app, no component rewrites. Off-chain play-money path is DEFAULT + must keep working. Some polish may already be partly applied — make it consistent/idempotent, don't duplicate.
- Existing Tailwind tokens only (canvas-*, ink-*, primary- blue, yes/teal green, no/scarlet red). No hardcoded hex / raw palette in dark UI.
- REAL ONLY, no mock/stub/faked success. No secrets. Plain copy, icon-first, no "Manifold"/"Oracle"/tech-name leaks.
- \`npx tsc --noEmit\` in ${WEB} allowed (slow). No next build/dev.`

const DIRECT = `USE THE REAL CONTRACTS DIRECTLY — do NOT write, wrap, vendor, or reimplement any Solidity:
- ${CONTRACTS}/uma-ctf-adapter — Polymarket's REAL UmaCtfAdapter (trustless UMA settlement). MIT. Already forge-built (ABIs in its out/), has its OWN deploy script (script/deploy/DeployAdapter.s.sol) + .env.example. forge test passes (61+).
- ${CONTRACTS}/ctf-exchange — Polymarket's REAL CTF Exchange (trading). MIT. Already forge-built (ABIs in its out/), has its OWN deploy script (script/deploy/ExchangeDeployment.s.sol) + .env.example.
The primitives (Gnosis ConditionalTokens, USDC, UMA OptimisticOracleV2) are ALREADY deployed on Polygon — call them at their real addresses. The user deploys the two Polymarket contracts DIRECTLY with the repos' own scripts. Your job is ONLY the app-side wiring + a short deploy pointer. Take the ABIs from each repo's out/ directory.`

function ui(label, phaseTitle, spec) {
  return agent(`${spec}

Web app: ${WEB} (Next.js pages router, Tailwind, TS).
${HARD}
Output: files edited/created (1 line each), confirmation logic/data preserved + tsc clean for your files.`, { label, phase: phaseTitle, agentType: 'general-purpose' })
}

// ---------- Phase 1: Polish ----------
phase('Polish')
log('Polymarket polish (idempotent).')
const tokens = () => ui('token-cleanup', 'Polish', `Ensure a consistent Polymarket palette. Sweep web/components + web/pages; map non-token colors to tokens: text/stroke/bg-indigo-* -> primary-*; violet-* balance (nav/profile-summary.tsx, nav/bottom-nav-bar.tsx) -> on-palette primary; stray bg-gray-*/text-gray-* on dark canvas -> canvas-*/ink-*. Idempotent, presentation only, grep thoroughly.`)
const marketBox = () => ui('market-trade-box', 'Polish', `Ensure MARKET PAGE + TRADE BOX are Polymarket-quality with a real depth panel. contract-page.tsx + web/components/bet/*: right trade card (YES/NO segmented green/red, amount + quick chips, live payout/avg-price/"to win", prominent Buy, limit under "Advanced") reusing existing bet logic. Depth/recent-trades from REAL data. Keep mobile stacking. Idempotent.`)
const folioLeader = () => ui('portfolio-leaderboard', 'Polish', `Ensure PORTFOLIO + LEADERBOARD are Polymarket-reskinned (existing pages/components). Portfolio: value + P&L header (green/red), positions list, tokens not hex, preserve data. Leaderboard: clean ranked list, primary-accent rank, preserve queries. Idempotent, presentation only.`)
const polish = (await parallel([tokens, marketBox, folioLeader])).filter(Boolean)

// ---------- Phase 2: viem client wired DIRECTLY to the real ABIs ----------
phase('Client')
log('viem wallet + on-chain buy/sell/redeem wired directly to the real Polymarket contract ABIs.')
const walletCore = await agent(`Build the on-chain CRYPTO CORE at ${WEB}/lib/onchain/, porting Aether wallet patterns to WEB:
- crypto.ts: AES-256-GCM + PBKDF2 mnemonic encryption via browser WebCrypto SubtleCrypto (pattern from ${WALLET}/utils/cryptoUtils.ts; no heavy dep).
- storage.ts: encrypted mnemonic blob + device key in SEPARATE stores (native secure-store bridge via postMessageToNative if present; else localStorage, key SEPARATE from ciphertext).
- chains.ts: EVM registry (Polygon primary + Base/Arbitrum/Optimism/Ethereum), free public RPC (env override), USDC address per chain.
- evmClient.ts: viem publicClient per chain; nativeBalance, erc20Balance(usdc), erc20Decimals, allowance, buildApprove/buildTransfer, send via walletClient.
- wallet.ts: bip39 mnemonic gen/import -> viem mnemonicToAccount (m/44'/60'/0'/0/0) -> address; encrypt+persist; unlock()->walletClient; getAddress(); wipe(). Never expose mnemonic to UI.
Add deps viem + bip39 to ${WEB}/package.json and install (yarn); if disk-blocked, report + leave code correct. tsc your files.
${HARD}
Output: files, deps (or failure), real viem calls.`, { label: 'wallet-core', phase: 'Client', agentType: 'general-purpose' })

const settlementUi = await agent(`Wire the app DIRECTLY to the real Polymarket contracts + lib/onchain/* (from wallet-core). NO new Solidity.
${DIRECT}
${HARD}
- ${WEB}/lib/onchain/abi/: copy the JSON ABIs the client needs FROM the vendored repos' out/ dirs (UmaCtfAdapter from ${CONTRACTS}/uma-ctf-adapter/out, CTFExchange from ${CONTRACTS}/ctf-exchange/out) + standard ConditionalTokens + ERC20/USDC ABIs.
- ${WEB}/lib/onchain/market.ts: typed viem bindings that CALL those real contracts — read prices/positions/market+resolution state; approve USDC; buy/sell outcome tokens via the CTF Exchange; split/merge via ConditionalTokens; redeemPositions for USDC after resolution. Deployed addresses from NEXT_PUBLIC_* env (document each: adapter, exchange, conditionalTokens, usdc, umaOptimisticOracle).
- settlement.ts: settlementOf(contract) -> 'onchain'|'offchain' (crypto/usdc group or a market field); default offchain.
- Create-market: "Off-chain (free) / On-chain (crypto)" toggle; on-chain path prepares the CTF condition + UmaCtfAdapter question (via market.ts calling the real adapter) and tags the market so settlementOf()==='onchain'.
- Market page/card: on-chain marker (icon + "Crypto"); on-chain markets show USDC + wallet balance, route buy/sell/redeem through REAL viem txs to the real contracts; a ConnectWalletSheet (create/import wallet, show address + USDC). Post-resolution Redeem = real redeemPositions payout.
- Off-chain markets + play-money experience UNCHANGED when off-chain / flag disabled.
tsc your files. Output: files, the exact real on-chain tx each button sends + which real contract it targets.`, { label: 'settlement-ui', phase: 'Client', agentType: 'general-purpose' })

// ---------- Phase 3: Deploy pointer (use the repos' OWN scripts) ----------
phase('Deploy-Doc')
log('Short deploy pointer using the repos own scripts — no new scripts.')
const deployDoc = await agent(`Write ${CONTRACTS}/DEPLOY.md: a concise guide to deploy the REAL Polymarket contracts DIRECTLY using the repos' OWN existing scripts — do NOT write new deploy scripts or contracts.
${DIRECT}
Read each repo's README + .env.example + script/deploy/*.s.sol and Makefile/package.json, then document, per repo, the EXACT steps the user runs: set the repo's own env vars (list them from its .env.example, explaining each + the real ConditionalTokens/USDC/UMA OptimisticOracleV2 addresses to use for Polygon 137 and Amoy 80002, sourced from the repo/UMA/Polymarket docs — cite sources, don't invent), then the repo's own forge command (e.g. its make target or \`forge script script/deploy/DeployAdapter.s.sol --broadcast --verify\`). Then: how to take the resulting deployed addresses + the out/ ABIs into the web app's NEXT_PUBLIC_* env so the viem client (lib/onchain) targets them. No secrets. Output: DEPLOY.md path + the exact env var names the web app expects.`, { label: 'deploy-doc', phase: 'Deploy-Doc', agentType: 'general-purpose' })

// ---------- Phase 4: OSS liquidity ----------
phase('OSS')
log('liquify (MIT) as automated market-making.')
const liquify = await agent(`Integrate liquify (MIT bot at ${PRED}/liquify) as Predikt's automated LIQUIDITY provider. Read its README/config, configure it against the Predikt/oracle backend API (base + key via env, no secret). Write ${PRED}/liquify/PREDIKT.md (how to run as a companion service). Separate node service; don't add a runtime dep or rewrite it. Report config + run steps.`, { label: 'liquify', phase: 'OSS', agentType: 'general-purpose' })

// ---------- Phase 5: Integrate ----------
phase('Integrate')
log('Typecheck web app + fix breakage.')
const integrate = await agent(`Integrate all Predikt web changes in ${WEB}. Run \`npx tsc --noEmit\` (slow) and FIX every error from polish + on-chain client WITHOUT removing behavior. Reconcile drift between lib/onchain/* and call sites. Confirm off-chain play-money path compiles + is default. No next build/dev. Output: tsc before->after, files fixed, off-chain intact + on-chain gated.`, { label: 'integrate', phase: 'Integrate', agentType: 'build-error-resolver' })

// ---------- Phase 6: Review ----------
phase('Review')
log('Security review (client + real-contract wiring) + UI review.')
const chainReview = await agent(`SECURITY review Predikt's on-chain integration (client-side only — the contracts are unmodified real Polymarket repos).
Confirm: lib/onchain calls the REAL contracts (ABIs from the repos' out/) and DEPLOY.md uses the repos' OWN deploy scripts with CORRECT real ConditionalTokens/USDC/UMA OptimisticOracleV2 addresses per chain (flag any invented address); resolution is genuinely trustless (UMA) not an owner switch; mnemonic never plaintext; encryption key in a SEPARATE store from ciphertext; no key/mnemonic logged; all on-chain reads/writes REAL viem (no faked success); addresses/ABIs from env; USDC approvals scoped. Off-chain path intact + default.
Report CRITICAL/HIGH/MED/LOW with file:line + a 0-10 score + testnet go/no-go + any wrong address.`, { label: 'chain-review', phase: 'Review', agentType: 'security-reviewer' })
const uiReview = await agent(`REVIEW the Polymarket polish + toggle in ${WEB}: consistent theme tokens (no indigo/violet/gray leaks); market trade box + depth/recent-trades use REAL data; portfolio + leaderboard reskinned + data intact; per-market off-chain/on-chain toggle + on-chain marker clear; no tech-name leaks; no mock/stub. Report findings + a 0-10 "Polymarket look + intact behavior" score.`, { label: 'ui-review', phase: 'Review', agentType: 'code-reviewer' })

return { polish: polish.length, walletCore, settlementUi, deployDoc, liquify, integrate, chainReview, uiReview }
