export const meta = {
  name: 'iterate-develop-aether',
  description: 'Iteration 3: harden Aether Wallet — the 7 non-EVM chain adapters (balance/send/history), secure-key + chain/swap/portfolio math test coverage, robustness, and a11y. Verify.',
  phases: [
    { title: 'Develop' },
    { title: 'Verify' },
  ],
}

const A = '/Users/arhansubasi/expo games and apps/rn-crypto-wallet'
const ENV = `Headless: no device, disk may be tight — no heavy fresh installs; run \`npx tsc --noEmit\` + the test script only if node_modules exists, else careful typed edits. Real RPC round-trips need a device/network — cannot be run here; harden + UNIT-test the pure logic (derivation, encoding, amount/fee math, parsing, state) and make the code defensively correct. REAL tests only (no mocks-of-production, no empty asserts). No secrets. Keep secure key handling intact (split-key SecureStore, no plaintext mnemonic). Keep EVM/Solana working. Do NOT re-disable the 7 chains.`

phase('Develop')
log('Harden Aether: non-EVM chains + core crypto/math + a11y.')

const chains = () => agent(`Harden Aether's 7 non-EVM CHAIN adapters/services at ${A} (Bitcoin, Tron, Cosmos, Polkadot, NEAR, Aptos, Sui). For each *Service.ts / *ChainAdapter.ts:
- Add FOCUSED unit tests for the PURE, device-independent logic: address derivation/validation, amount<->base-unit conversion + fee math, tx-build/encode payload shaping, and response PARSING (balance/history) from realistic fixture JSON. Assert real outputs.
- Robustness: guard undefined/NaN/empty responses, malformed addresses, network-error fallbacks (return an honest empty/error state, never crash), and unconfigured-RPC safety. Ensure the generic chains slice/selectors/thunks handle a chain returning an error without breaking the portfolio list.
- Confirm each chain's balance/history/send path is wired end-to-end in code (GenericTokenDetail/GenericSend) and note honestly which parts still require a live network to verify.
${ENV}
Output: tests added per chain, robustness guards, what's code-verified vs needs-network, tsc/test result.`, { label: 'aether:chains', phase: 'Develop', agentType: 'general-purpose' })

const core = () => agent(`Harden Aether's CORE (security + math + UX) at ${A}:
- Test the secure-key layer (utils/cryptoUtils.ts: PBKDF2+AES encrypt/decrypt round-trip, wrong key fails, key never beside ciphertext) + derivation-path constants + the EVM chain registry (constants/evmChains, chainRegistry: unique chainIds, one address across EVM, consistent config).
- Test the pure swap/portfolio/currency math (utils/currency, portfolio net-worth, swap quote/slippage/amount math) with edge cases (0, huge, negative, missing price).
- Accessibility: add accessibilityLabel/role/hint to interactive controls on the key screens (home/portfolio, token detail, send, swap, receive, settings) — especially icon-only buttons; don't restyle.
- Robustness: loading/error/empty states on data screens; safe fallbacks when a service (swap/nft/ramp/price) is unconfigured or errors; no crash on missing native module (WalletConnect/passkeys already dev-build-gated — keep that).
${ENV}
Output: tests added, a11y labels (count + screens), robustness guards, tsc/test result.`, { label: 'aether:core', phase: 'Develop', agentType: 'general-purpose' })

const done = (await parallel([chains, core])).filter(Boolean)

phase('Verify')
log('Verify iteration 3 (Aether).')
const review = await agent(`Verify Aether iteration 3 hardening at ${A}. Confirm PASS/PARTIAL/FAIL:
- Chains: real unit tests for the 7 non-EVM adapters' pure logic (derivation/encoding/parsing/fee math); a chain error doesn't break the portfolio; the 7 chains remain enabled + wired.
- Core: secure-key tests hold the invariants (no plaintext mnemonic, key separate from ciphertext); swap/portfolio math edge cases covered; EVM/Solana not regressed.
- A11y: interactive controls on key screens labeled.
- No regressions: tsc + tests green, no secrets, security intact.
Report per-track: tests added (count), coverage/robustness gained, residual (esp. what needs a live network/device), a 0-10 quality-delta, and the top 3 for the NEXT iteration.`, { label: 'verify', phase: 'Verify', agentType: 'code-reviewer' })

return { done: done.length, review }
