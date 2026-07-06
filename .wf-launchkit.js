export const meta = {
  name: 'predikt-launch-kit',
  description: 'One-command local full-stack demo (anvil + all contracts + relay + market maker + seeded market, runnable) + deploy automation wrapping the repos own scripts. Disjoint from oracle/web. Verify by running.',
  phases: [
    { title: 'LocalDemo' },
    { title: 'DeployKit' },
    { title: 'Verify' },
  ],
}

const PRED = '/Users/arhansubasi/expo games and apps/prediction'
const C = '/Users/arhansubasi/expo games and apps/prediction/predikt-contracts'
const RELAY = '/Users/arhansubasi/expo games and apps/prediction/predikt-relay'
const FPMM = '/Users/arhansubasi/expo games and apps/prediction/predikt-contracts/fpmm'

const RULE = `Do NOT touch oracle/web (another workflow owns it). Work only in ${PRED}/predikt-relay, ${PRED}/predikt-contracts, ${PRED}/fpmm... (i.e. predikt-contracts/fpmm), and a NEW ${PRED}/demo/ dir + top-level docs. REAL ONLY — real anvil, real deploys, real relay/MM, no mocks/faked steps. Reuse the existing e2e harnesses (predikt-relay/test/e2e/run.mjs and predikt-contracts/fpmm/test-e2e/run.mjs) and the existing deploy scripts — do not reimplement contracts or the AMM. anvil/forge/cast are installed; reuse installed node_modules (viem is in predikt-relay). No secrets committed.`

// ---------- Phase 1: one-command full-stack local demo ----------
phase('LocalDemo')
log('Build a one-command local demo that boots the whole on-chain stack together.')
const demo = await agent(`Build a ONE-COMMAND local full-stack demo for Predikt at ${PRED}/demo/ that boots the entire on-chain stack together and proves it works, then leaves it running for manual poking (with a clean teardown on Ctrl-C).
${RULE}
Study and reuse the two existing harnesses:
- ${RELAY}/test/e2e/run.mjs (boots anvil, deploys USDC + ConditionalTokens + CTFExchange, funds accounts, starts the relay, submits signed orders, matches via matchOrders, asserts fills) and its artifacts.mjs.
- ${FPMM}/test-e2e/run.mjs (deploys the FPMM factory, creates + seeds a pool, buy/sell) and its setup-deps.mjs.
Build ${PRED}/demo/run.mjs that:
1) Boots one anvil, deploys the FULL set once: USDC(6dp) + ConditionalTokens + CTFExchange + (if feasible) the UmaCtfAdapter with a mock oracle + the FPMM factory. Print all addresses.
2) prepareCondition + registerToken + grant the relay operator role; seed BOTH venues — an FPMM pool via addFunding AND the relay CLOB via the market maker (start ${RELAY} + \`npm run mm\` against these addresses, or post a couple of maker orders directly).
3) Start the relay HTTP server against anvil. Print the relay URL + the env block a developer would paste into oracle/web/.env.local (NEXT_PUBLIC_ONCHAIN_* + RELAY_URL) to point the web app at this local stack.
4) Run a quick self-check (a taker buy via the router logic: quote AMM vs CLOB, execute the better one, assert the on-chain fill) so the demo proves itself, then stay up until Ctrl-C, tearing down anvil + relay cleanly.
Add a \`demo\` npm script (package.json in ${PRED}/demo) and a README with exactly what it does + how to run + the env to paste into the web app. RUN it once headlessly (timeboxed: boot → self-check → teardown) and report the REAL result.
Output: the demo script, what it boots, the printed env block, and the actual run result.`, { label: 'local-demo', phase: 'LocalDemo', agentType: 'general-purpose' })

// ---------- Phase 2: deploy automation ----------
phase('DeployKit')
log('Deploy automation wrapping the repos own scripts (Amoy -> Polygon) + env wiring.')
const deploy = await agent(`Build DEPLOY AUTOMATION at ${C}/deploy-kit/ that wraps the repos' OWN deploy scripts into a guided, ordered flow so an operator can go live with minimal steps. Do NOT write new Solidity or new deploy contracts — orchestrate the existing ones.
${RULE}
- A script (Node) that, given env (PRIVATE_KEY, RPC, chain = amoy|polygon), runs the existing deploy scripts in the correct ORDER with the correct real addresses: (1) CTFExchange (its ExchangeDeployment script — collateral = native USDC to match the web app), (2) UmaCtfAdapter (its DeployAdapter script — real ConditionalTokens + UMA OO addresses), (3) an FPMM factory deploy (reuse ${FPMM}/script/deploy-fpmm.mjs pattern), then (4) grant the relay operator address the exchange operator role (addOperator). Collect all deployed addresses into a single addresses.<chain>.json.
- A step that emits the exact env blocks to paste: oracle/web (NEXT_PUBLIC_ONCHAIN_*), predikt-relay (.env), and the market maker — from the deployed addresses. No secrets written to disk.
- Update ${C}/DEPLOY.md with a short "Automated deploy" section pointing at this kit (keep the manual per-repo instructions too). Idempotency + safety notes (testnet Amoy first, verify addresses).
This is orchestration + docs; it won't run against a live chain here (no funded key) — make it correct + dry-runnable, and say clearly it needs the operator's key/funds to actually execute.
Output: the deploy-kit script(s), the ordered flow, the addresses.json shape, the env blocks emitted, and the DEPLOY.md addition.`, { label: 'deploy-kit', phase: 'DeployKit', agentType: 'general-purpose' })

// ---------- Phase 3: verify ----------
phase('Verify')
log('Verify the demo runs + the deploy kit is sound.')
const verify = await agent(`Verify the Predikt launch kit. Confirm: ${PRED}/demo runs headlessly on anvil (boot → deploys the full stack → seeds both venues → self-check taker trade asserts a real on-chain fill → clean teardown), reporting the REAL result (re-run it if needed, timeboxed); the deploy-kit at ${C}/deploy-kit orders the repos' OWN deploy scripts correctly with real addresses and emits correct env blocks (no invented addresses, no secrets); nothing touched oracle/web. Report pass/fail per piece, the demo's actual run output, and a 0-10 "launch readiness" score.`, { label: 'verify', phase: 'Verify', agentType: 'general-purpose' })

return { demo, deploy, verify }
