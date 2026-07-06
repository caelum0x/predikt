export const meta = {
  name: 'close-code-side-gaps',
  description: 'Close the headless-fixable gaps across apps: Predikt compliance site, encrypt bot keys, enable Aether dormant chains, server-side Huddle scheduling, prune Predikt dead pages, wire game analytics. Disjoint apps, staggered. Verify.',
  phases: [
    { title: 'Fix' },
    { title: 'Verify' },
  ],
}

const ROOT = '/Users/arhansubasi/expo games and apps'
const ENV = `Headless: NO device/simulator, disk may be tight — do NOT run heavy fresh installs; run \`npx tsc --noEmit\` / the app's build only if node_modules already exists, else rely on careful typed edits. Be honest that runtime is not verified. REAL ONLY (no mock/stub), no secrets committed, keep existing behavior + brand, plain copy.`

function fix(label, spec) {
  return agent(`${spec}
${ENV}
Output: files changed, what now works, and the tsc/build result (or why not runnable).`, { label, phase: 'Fix', agentType: 'general-purpose' })
}

phase('Fix')
log('Close 6 code-side gaps across disjoint apps (staggered 3+3).')

// 1) Predikt compliance site (launch blocker) — in websites/
const compliance = () => fix('predikt-site', `Add a full **Predikt** compliance + marketing site to the websites project at ${ROOT}/websites, so it's no longer missing (it currently generates sites for aether/cipher/huddle/vertex but ZERO for Predikt — a launch blocker).
- Study the existing generator (build.mjs + the per-app dirs aether/cipher/huddle/vertex) and add **predikt** as a 5th app the SAME way: a landing page + **privacy policy, terms/EULA, support, delete-account** pages, matching the existing structure/styling/build.
- Write REAL, accurate content for a prediction market: data collected (account, email, wallet address, on-chain activity, KYC where applicable), play-money vs on-chain USDC, third parties (Supabase/Firebase, OpenRouter AI, the on-chain contracts/UMA, any KYC/on-ramp), account + data deletion, jurisdiction/eligibility + "not financial advice", contact/support. Plain, clear, no placeholders left (use a REPLACE_WITH_ email/domain constant where a real value is unknown, clearly marked).
- Wire predikt into the root index + build config + CANONICAL-URLS.md so \`npm run build\` (or the generator) emits the Predikt pages. Run the build if runnable.`)

// 2) Encrypt bot key storage — prediction/herald + relay-tg
const botKeys = () => fix('bot-keys', `Encrypt the per-user API key storage in BOTH Predikt bots (currently plaintext keys.json): ${ROOT}/prediction/herald and ${ROOT}/prediction/relay-tg.
- Add AES-256-GCM encryption at rest: a small crypto module that encrypts/decrypts each stored key using a symmetric key derived (PBKDF2/scrypt) from a required env secret \`KEY_ENCRYPTION_SECRET\` (document it in .env.example; refuse to start / warn loudly if unset).
- Update the storage layer (herald/src/storage.ts and relay-tg's storage) so keys are encrypted on write and decrypted on read; MIGRATE any existing plaintext keys.json on first load (detect unencrypted entries, encrypt them, rewrite). Keep the JSON file gitignored.
- Don't change the bot command behavior. tsc/build each.`)

// 3) Enable Aether's 7 dormant non-EVM chains — rn-crypto-wallet
const aether = () => fix('aether-chains', `Enable Aether Wallet's 7 dormant non-EVM chains at ${ROOT}/rn-crypto-wallet (BTC, Tron, Cosmos, Polkadot, Near, Aptos, Sui — currently \`enabled: false\` in src/constants/chainRegistry.ts, but their integrations are built).
- Flip them to enabled and, for EACH, verify + complete the end-to-end wiring the app needs: balance read, send/transfer, and tx history via their existing service adapters/SDKs. Where an adapter is incomplete, finish it using the already-present SDK (do NOT add paid APIs; use public RPCs/free endpoints). Where a real value is needed, use a documented env/config default, not a hardcode.
- Ensure the chain-select UI + portfolio + send flows include these chains without breaking the EVM/Solana paths. Keep secure key handling intact. tsc.
- Be honest about which chains are fully wired vs still need a runtime/device check.`)

const b1 = await parallel([compliance, botKeys, aether])

// 4) Server-side Huddle scheduled-send/reminders — slack-clone
const huddle = () => fix('huddle-schedule', `Make Huddle's scheduled-send + reminders SERVER-SIDE at ${ROOT}/slack-clone-react-native (today they're on-device: src/projects/reminders.ts + useReminderFlush.ts + engagement/useEventReminderFlush.ts fire only while the app is open).
- Preferred: if the Matrix homeserver supports **delayed/future events (MSC4140)**, send scheduled messages via the delayed-event API so the SERVER dispatches them at the scheduled time (works when the app is closed). Implement a client that schedules via MSC4140 with a fallback.
- Fallback (if MSC4140 unavailable): add a small server worker (Node) that persists scheduled messages/reminders and dispatches them at time via the Matrix API (using an appservice/bot or the user's stored token), plus a scheduling client in the app. Put the worker in a new ${ROOT}/slack-clone-react-native/server/ (or huddle-scheduler/) dir with its own package.json/.env.example (no secrets).
- Keep the existing on-device queue as a fallback; the UI (scheduled.tsx/reminders.tsx) should now schedule server-side. tsc/build.
- Be honest about what needs a running homeserver to verify.`)

// 5) Prune Predikt's dead Manifold marketing pages — prediction/oracle/web
const prune = () => fix('prune-pages', `Prune/rebrand Predikt's dead Manifold-specific marketing/vanity pages at ${ROOT}/prediction/oracle/web/pages that don't belong in Predikt (e.g. mana-auction, manachan, complexsystems, cowp, the various one-off landing/lab/election-needle/charity-giveaway/twitch vanity pages) — WITHOUT breaking routing, nav, or internal links.
- For each candidate: if it's dead weight/Manifold-vanity → remove it AND remove/redirect any nav entries or internal links pointing to it (grep for the route); if it's a real feature under a Manifold name → rebrand the copy to Predikt. Keep the core product pages (markets/browse, market detail, portfolio, profile, leaderboards, create, notifications, admin, cash/checkout, community-guidelines, embeds).
- Do a final grep to confirm no broken \`Link href\`/router.push to a removed route. tsc.
- List exactly which pages you removed vs rebranded vs kept.`)

// 6) Wire real analytics into the games — Vertex + Cipher
const analytics = () => fix('game-analytics', `Wire a REAL, free analytics backend into the two games — Vertex (${ROOT}/pillar-valley) and Cipher (${ROOT}/TheLock) — replacing local-only tracking (Cipher has a local-only src Analytics.ts; Vertex lacks a backend).
- Use a free/OSS analytics option (e.g. PostHog free tier / self-host, or Supabase 'events' table) behind a thin \`analytics\` module with a stable API (track(event, props), screen(name), identify). Key/host from env (EXPO_PUBLIC_*), no hardcode; when unset it no-ops (offline-safe) — do NOT break the games when analytics is disabled.
- Instrument the key funnels each game already has: app_open, game_start, game_over/score, purchase_start/success, level/mode_select, retention (streak/daily). Reuse existing event call sites; don't scatter.
- Keep it lightweight, typed, privacy-conscious (no PII). tsc each.`)

const b2 = await parallel([huddle, prune, analytics])
const fixes = [...b1, ...b2].filter(Boolean)

// ---------- Verify ----------
phase('Verify')
log('Verify each fix (static).')
const verify = await agent(`Verify the 6 gap-fixes across the apps (static — no device). For each, confirm it's real (no mock/stub), didn't break the app, and note the tsc/build result:
1) ${ROOT}/websites — Predikt landing+privacy+terms+support+delete pages exist + build config wired (no missing legal page); no unresolved placeholders beyond clearly-marked REPLACE_WITH_*.
2) ${ROOT}/prediction/herald + relay-tg — keys encrypted at rest (AES-GCM via KEY_ENCRYPTION_SECRET), plaintext migration present, keys.json gitignored, tsc/build clean.
3) ${ROOT}/rn-crypto-wallet — the 7 non-EVM chains enabled + their balance/send/history wired (list which are fully wired vs need device check), EVM/Solana intact, tsc clean.
4) ${ROOT}/slack-clone-react-native — scheduling is now server-dispatched (MSC4140 or a server worker), UI wired, tsc/build clean.
5) ${ROOT}/prediction/oracle/web — dead pages pruned/rebranded with NO broken links (grep-confirmed), core pages intact, tsc clean.
6) ${ROOT}/pillar-valley + ${ROOT}/TheLock — real analytics module wired to a free backend, env-gated no-op when unset, key funnels instrumented, tsc clean.
Report per-fix PASS/PARTIAL/FAIL + file:line for any issue + a short "what still needs a device/live-service to fully verify" note.`, { label: 'verify', phase: 'Verify', agentType: 'code-reviewer' })

return { fixes: fixes.length, verify }
