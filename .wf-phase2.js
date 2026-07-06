export const meta = {
  name: 'predikt-phase2-hybrid-liquidity',
  description: 'Phase 2: add the real Gnosis FPMM AMM (ours, forge-built) alongside the CLOB so every on-chain market is instantly tradeable, + a best-execution client router, verified on anvil e2e. Review.',
  phases: [
    { title: 'BuildAMM' },
    { title: 'DeployE2E' },
    { title: 'Router' },
    { title: 'Review' },
  ],
}

const C = '/Users/arhansubasi/expo games and apps/prediction/predikt-contracts'
const FPMM = '/Users/arhansubasi/expo games and apps/prediction/predikt-contracts/fpmm'
const RELAY = '/Users/arhansubasi/expo games and apps/prediction/predikt-relay'
const WEB = '/Users/arhansubasi/expo games and apps/prediction/oracle/web'

const OWN = `The AMM is Predikt's OWN code now: ${FPMM} = Gnosis FixedProductMarketMaker + FPMMDeterministicFactory (real OSS, LGPL-3.0 — a DEPLOYED contract the app calls via ABI, not bundled into the app, so it's fine; keep a clear LICENSE/NOTICE). USE IT DIRECTLY — do not reimplement the AMM math (calcBuyAmount/calcSellAmount/buy/sell/addFunding already exist). You MAY modify/rebrand/integrate it (it's ours). Hard rule: keep the AMM pricing LOGIC correct; verify by building + tests. It is Solidity ^0.5.1 — forge auto-selects solc 0.5, no Truffle needed.`

// ---------- Phase 1: build the AMM with forge ----------
phase('BuildAMM')
log('Make the Gnosis FPMM compile under forge (solc 0.5), rebranded as ours.')
const build = await agent(`Get the FPMM AMM at ${FPMM} building under Foundry so it is deploy-ready.
${OWN}
Its imports need resolving for a forge build:
- \`openzeppelin-solidity/contracts/...\` (IERC20, SafeMath) — OpenZeppelin 0.5.x era.
- \`@gnosis.pm/conditional-tokens-contracts/contracts/...\` (ConditionalTokens, CTHelpers, ERC1155/ERC1155TokenReceiver).
- \`@gnosis.pm/util-contracts/contracts/ConstructedCloneFactory.sol\`.
Tasks:
1) Resolve deps: \`npm install\` the exact 0.5-compatible packages (openzeppelin-solidity@^2.x, @gnosis.pm/conditional-tokens-contracts, @gnosis.pm/util-contracts) into ${FPMM}, then add a \`foundry.toml\` with remappings pointing at node_modules so \`forge build\` resolves the imports. (Vendor the few needed files instead only if npm resolution fights you.)
2) Ensure forge uses solc 0.5.x for these (pragma ^0.5.1). Run \`forge build\` and get FixedProductMarketMaker.sol + FPMMDeterministicFactory.sol (+ ConditionalTokens for tests) compiling. Report the result honestly; if a specific import can't resolve, say which and why.
3) Rebrand the surface to Predikt where safe (package.json name → @predikt/fpmm, README) WITHOUT changing the AMM math. Add a NOTICE noting the LGPL-3.0 origin (Gnosis) + that it is deployed standalone.
Output: foundry.toml/remappings, deps installed, \`forge build\` result (which contracts compiled), and the ABI path for FixedProductMarketMaker + factory.`, { label: 'build-amm', phase: 'BuildAMM', agentType: 'general-purpose' })

// ---------- Phase 2: deploy script + anvil e2e ----------
phase('DeployE2E')
log('Deploy script + anvil e2e proving buy/sell against the AMM.')
const e2e = await agent(`Make the FPMM AMM deploy-ready and PROVE it works on a local anvil chain (mirror the relay's existing e2e at ${RELAY}/test/e2e/run.mjs which already spins up anvil + deploys CTF/USDC).
${OWN}
1) Deploy: a forge script (or reuse the factory's own create pattern) that, given a ConditionalTokens + collateral USDC + a conditionId, creates an FPMM pool via FPMMDeterministicFactory (fee param, e.g. 2%). Parameterize by env. Document in ${C}/DEPLOY.md (append an "AMM (instant liquidity)" section) how a market creator seeds a pool with \`addFunding\`.
2) E2E (a runnable script under ${FPMM}/test-e2e/ or extending the relay harness): on anvil — deploy USDC(6dp)+ConditionalTokens+FPMM factory → prepareCondition → create an FPMM pool for the condition → \`addFunding\` with USDC (seeds YES/NO liquidity) → a taker \`calcBuyAmount(investment, YES)\` then \`buy(...)\` and assert they received YES outcome tokens and USDC left their balance (real on-chain reads) → \`sell(...)\` back and assert → tear down. Add an \`npm run e2e:amm\` (or forge test) entrypoint and RUN it, reporting the REAL asserted balances. Honest partial results are fine.
Output: deploy script, the e2e harness, the ACTUAL run result (assloaded balances per step), and the DEPLOY.md addition.`, { label: 'amm-e2e', phase: 'DeployE2E', agentType: 'general-purpose' })

// ---------- Phase 3: client router ----------
phase('Router')
log('Client AMM bindings + best-execution router in the trade box.')
const router = await agent(`Wire the AMM into the Predikt web app ${WEB} and add a best-execution router, so on-chain markets are instantly tradeable even with an empty order book.
${OWN}
- ${WEB}/lib/onchain/amm.ts: viem bindings to the FPMM (ABI from ${FPMM}'s forge out/) — poolFor(conditionId)/exists, calcBuyAmount, buy (approve USDC → buy), calcSellAmount, sell, addFunding, and a price read (marginal price per outcome). Pool address from a factory lookup or NEXT_PUBLIC_ONCHAIN_FPMM_FACTORY env + deterministic address.
- ${WEB}/lib/onchain/router.ts: given an on-chain market + a desired trade (outcome, USDC amount, buy/sell), quote BOTH venues — the CLOB book (existing lib/onchain/market.ts / relay GET /book) and the AMM (amm.ts calcBuyAmount) — and pick best execution (most outcome tokens for the spend). Return {venue, quote, execute()}.
- Update ${WEB}/components/onchain/onchain-trade-box.tsx: for on-chain markets, the MARKET buy/sell now uses the router (falls to the AMM when the book is thin/empty, to the CLOB when it's better), showing the effective price + which venue; keep the LIMIT-order (CLOB) path under Advanced, and mint/merge/redeem under Advanced. Real quotes only — no faked prices; graceful states when neither venue is available.
- If addresses/env are unset, on-chain stays hidden (unchanged off-chain default).
Run \`npx tsc --noEmit\` in ${WEB} → 0 errors. Output: files, how the router picks a venue, and the tsc result.`, { label: 'router', phase: 'Router', agentType: 'general-purpose' })

// ---------- Phase 4: review ----------
phase('Review')
log('Review the AMM integration + router.')
const review = await agent(`Review Phase 2 (hybrid liquidity). Confirm: the FPMM AMM (${FPMM}) is the real Gnosis math (unmodified pricing) building under forge; the e2e actually executed real buy/sell on anvil with asserted balances (flag if it only partially ran); the client router (${WEB}/lib/onchain/router.ts) quotes BOTH the CLOB and the AMM and picks best execution with REAL quotes (no faked prices); the trade box falls back to the AMM when the book is empty; off-chain play-money path is untouched + default; LGPL origin is noted; tsc clean; no secrets. Report CRITICAL/HIGH/MED/LOW + a 0-10 score + whether every on-chain market is now instantly tradeable.`, { label: 'review', phase: 'Review', agentType: 'code-reviewer' })

return { build, e2e, router, review }
