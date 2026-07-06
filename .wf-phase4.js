export const meta = {
  name: 'predikt-phase4-creator-social-distribution',
  description: 'Phase 4: the supply+distribution flywheel — creator fee earnings surfaced, follow + copy-trading, calibration/reputation, embeddable market widgets, and a Telegram bot. Integrate + review.',
  phases: [
    { title: 'Social' },
    { title: 'Distribution' },
    { title: 'Integrate' },
    { title: 'Review' },
  ],
}

const WEB = '/Users/arhansubasi/expo games and apps/prediction/oracle/web'
const PRED = '/Users/arhansubasi/expo games and apps/prediction'
const HERALD = '/Users/arhansubasi/expo games and apps/prediction/herald'

const RULE = `Existing Manifold Next.js app reskinned as Predikt. EDIT IN PLACE, preserve off-chain default + existing logic/data. Theme tokens only (canvas-*, ink-*, primary- blue, yes/teal green, no/scarlet red), icon-first, plain copy, no tech/product-name leaks. Strict TS, no \`any\`. REAL ONLY — real API/data, no mock/stub/faked numbers. FREE/OSS. \`npx tsc --noEmit\` in ${WEB} must be 0 errors. Don't touch common/ or backend/. Reuse existing hooks/APIs (follows, contract-metrics, user profit/calibration, bets) — surface them, don't invent fake stats.`

// ---------- Phase 1: social + creator economy ----------
phase('Social')
log('Creator earnings + follow + copy-trading + calibration/reputation.')

const creator = () => agent(`Surface the CREATOR ECONOMY in ${WEB} so market creators see (and are incentivized by) their earnings — the supply flywheel Kalshi/Polymarket lack.
${RULE}
- Find where creator fees/earnings exist in the data (contract fees, creator fee fields, the app's fee model) and surface a creator's earnings on their profile + on markets they created ("created by you · earned N"). Use REAL fee/earnings data from the existing API/metrics — if a field doesn't exist, show what genuinely does (volume/traders on your markets) and clearly label it; do NOT fabricate an earnings number.
- A "Your markets" dashboard section (creator's markets with volume, traders, earnings), plain + icon-first.
- Make market creation feel rewarding: after creating, a share card + "you earn a cut when people trade this" plain note (only if the fee model actually gives creators a cut — otherwise omit the claim).
Output: files, which real fields you surfaced, what you deliberately did NOT fabricate.`, { label: 'creator', phase: 'Social', agentType: 'general-purpose' })

const social = () => agent(`Build the SOCIAL layer in ${WEB}: follow + copy-trading + calibration/reputation.
${RULE}
- Follow: surface/complete follow buttons on trader profiles + a "following" feed of the people you follow's recent trades (reuse existing follows API + bets).
- Copy-trading: on a trader's trade (in their profile or the following feed), a "copy this trade" action that prefills the bet panel with the same market + outcome (and a suggested amount) via the existing bet flow — a real one-tap mirror using the real trade data, not an auto-executing bot (user confirms). Clearly labeled.
- Reputation: show each trader's CALIBRATION score + profit + win-rate on their profile using the app's real calibration/metrics data; a "top traders" enrichment on the leaderboard (calibration + profit). Real data only.
Output: files, the real data sources used, and how copy-trade prefill works.`, { label: 'social', phase: 'Social', agentType: 'general-purpose' })

const b1 = await parallel([creator, social])

// ---------- Phase 2: distribution (embeds + telegram) ----------
phase('Distribution')
log('Embeddable market widgets + Telegram bot.')

const embeds = () => agent(`Build DISTRIBUTION via embeddable market widgets in ${WEB} — markets should live anywhere on the web (Kalshi/Poly are walled).
${RULE}
- There is likely an existing /embed route (Manifold has embeds). Find it and make a clean, dark, Predikt-branded embeddable market widget: question + big YES/NO price + a mini chart + a "trade on Predikt" deep link, responsive, works in an iframe (proper headers/CSP frame-ancestors already handled). Real market data via the existing API.
- Add a "Embed" action on the market page that shows the <iframe> snippet to copy (and an image/OG share). Plain copy, icon-first.
- Ensure the embed is light + fast + isolated (no auth required to view).
Output: files, the embed URL structure, the iframe snippet format.`, { label: 'embeds', phase: 'Distribution', agentType: 'general-purpose' })

const telegram = () => agent(`Build a TELEGRAM bot for Predikt as a companion service (mirror the herald Discord bot's approach for reach on another platform). Create ${PRED}/relay-tg OR ${PRED}/telegram (a new small Node/TS service).
Reference ${HERALD} (the working Discord bot: real fetch client against the backend via ORACLE_API_URL, commands register/market/bet/create). Build the Telegram equivalent with a real Telegram Bot API library (e.g. grammY or node-telegram-bot-api, MIT) + a real fetch client against the Predikt backend (ORACLE_API_URL, per-user API key via /register, stored like herald). Commands: /start, /register <key>, /market <query> (show a market + prices), /bet, /create, /portfolio. REAL API calls only, no mocks. package.json + tsconfig + .env.example (BOT_TOKEN, ORACLE_API_URL; no secrets) + README. Make it typecheck/build.
Output: files, commands, run steps, build result.`, { label: 'telegram', phase: 'Distribution', agentType: 'general-purpose' })

const b2 = await parallel([embeds, telegram])

// ---------- Phase 3: integrate ----------
phase('Integrate')
log('Typecheck the web app + reconcile.')
const integrate = await agent(`Integrate Phase 4 in ${WEB}. Run \`npx tsc --noEmit\` and FIX every error from the creator/social/embed work without removing behavior; reconcile overlap (profile page gets creator earnings + calibration + follow; leaderboard gets reputation). Confirm off-chain default intact, no fabricated stats, real data sources. (The Telegram service is separate — just confirm it builds on its own.) Output: tsc before->after, files fixed.`, { label: 'integrate', phase: 'Integrate', agentType: 'build-error-resolver' })

// ---------- Phase 4: review ----------
phase('Review')
log('Review Phase 4.')
const review = await agent(`Review Phase 4 in ${WEB} (+ the Telegram service): creator earnings use REAL fee/metric data (nothing fabricated — flag any made-up number); follow/copy-trade use real follows + real trade data and copy-trade only PREFILLS (no silent auto-execution); calibration/reputation from real metrics; embed widget renders real market data, is iframe-safe + auth-free, Predikt-branded; Telegram bot makes real backend calls (no mocks) + builds; theme tokens consistent; no tech-name leaks; tsc clean. Report CRITICAL/HIGH/MED/LOW + a 0-10 score + whether the distribution/supply flywheel is real.`, { label: 'review', phase: 'Review', agentType: 'code-reviewer' })

return { social: b1.length, distribution: b2.length, integrate, review }
