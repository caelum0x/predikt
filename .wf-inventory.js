export const meta = {
  name: 'all-apps-inventory-gap-analysis',
  description: 'Enumerate all 6 products (Predikt, Vertex, Aether Wallet, Huddle, Cipher, Websites) in parallel — pages, APIs, functionality, features — then synthesize a master INVENTORY.md with a per-app gap analysis (what we are missing) + a root README listing all products.',
  phases: [
    { title: 'Enumerate' },
    { title: 'Synthesize' },
  ],
}

const ROOT = '/Users/arhansubasi/expo games and apps'
const SECT = '/Users/arhansubasi/expo games and apps/.inventory'

const RULE = `Produce a GROUNDED inventory from the ACTUAL code — enumerate what really exists, do not invent. GROUP by feature area (not one giant flat list); be concise (name + 1 short line each; for big lists give counts + the notable ones). Mark anything STUB/partial/disabled/behind-a-flag honestly. End your section with a short per-app GAP list: "What a best-in-class version of THIS app still needs" (Have ✅ / Partial 🟡 / Missing ❌). Write your section to the given file path (create ${SECT}/ if needed).`

function enumerate(label, name, path, focus, out) {
  return agent(`Inventory the app "${name}" at ${path}. Write your section to ${SECT}/${out}.
${RULE}
${focus}`, { label, phase: 'Enumerate', agentType: 'general-purpose' })
}

// ---------- Phase 1: parallel enumeration (staggered 3+3) ----------
phase('Enumerate')
log('Enumerate all 6 products in parallel -> section files.')

const predikt = () => enumerate('inv:predikt', 'Predikt (prediction market)', `${ROOT}/prediction`,
`This is the biggest — cover: WEB APP pages (oracle/web/pages, ~119 routes) grouped by area; WEB API routes (pages/api); BACKEND API (oracle/common/src/api/schema.ts, ~250 endpoints) grouped by domain WITH counts (markets, bets/trades, users/auth, comments, groups/topics, leagues, portfolio/metrics, notifications/push, payments/cash, social/DMs, search, admin); ON-CHAIN (predikt-contracts: ctf-exchange/uma-adapter/@predikt-orders/fpmm capabilities + deploy-kit); RELAY (predikt-relay REST + matcher + market maker); web lib/onchain modules; BOTS (liquify/autopilot/herald/relay-tg); MOBILE (oracle/native shell + push); DEMO. Note our NEW features (AI factory, hybrid AMM+CLOB, onboarding, creator/social, jurisdiction).`,
  '1-predikt.md')

const vertex = () => enumerate('inv:vertex', 'Vertex (game)', `${ROOT}/pillar-valley`,
`An Expo/React-Native GAME. Cover: SCREENS/routes (app/ or src/app), game MODES + mechanics, cosmetics/unlocks/season pass/quests, social (friends/challenges/leaderboards), monetization (IAP/ads/RevenueCat), services/APIs, stores/state, and native features (audio/haptics/ads). Group by area; note the game loop + progression systems.`,
  '2-vertex.md')

const aether = () => enumerate('inv:aether', 'Aether Wallet (crypto wallet)', `${ROOT}/rn-crypto-wallet`,
`An Expo/RN CRYPTO WALLET. Cover: SCREENS/routes; the big services/api/* domains (swap/curve/defi/nft/tokens/portfolio/aa[account-abstraction]/walletconnect/social/names/ramp/security/ai/payments) — list each with a capability line; supported CHAINS (constants/evmChains, solana, aaChains); features (send/receive/swap/DeFi/staking/NFT/WalletConnect/address-book/price-alerts/social-login/username); stores; security (secure key handling). Group + count.`,
  '3-aether.md')

const huddle = () => enumerate('inv:huddle', 'Huddle (team chat)', `${ROOT}/slack-clone-react-native`,
`An Expo/RN SLACK-style CHAT app. Cover: SCREENS/routes; features (workspaces/spaces, channels, DMs, threads, mentions, reactions, files/media, search, message scheduling/reminders, huddles/voice-video via the OSS RTC, presence, admin/roles/invites); services/APIs (Matrix/LiveKit/Supabase integration); stores; notifications. Group by area.`,
  '4-huddle.md')

const cipher = () => enumerate('inv:cipher', 'Cipher (game)', `${ROOT}/TheLock`,
`An Expo/RN puzzle GAME (Mastermind/Wordle-style). Cover: SCREENS/routes; game MODES (daily, time-attack, duels, tournaments), mechanics, progression/streaks/cosmetics, online/social (daily challenge, duels, spectate, leaderboards), stats, monetization (ads/IAP), services/state. Group by area.`,
  '5-cipher.md')

const websites = () => enumerate('inv:websites', 'Websites (marketing/legal)', `${ROOT}/websites`,
`Marketing + legal WEBSITES for the apps. Cover: per-app pages (landing/privacy/terms/support/delete-account) for each of aether/huddle/vertex/cipher (+ any Predikt), the root index, deploy config (GitHub Pages/Cloudflare), and the canonical URLs the apps reference. List what pages exist per app and note any missing legal/support page an App-Store submission needs.`,
  '6-websites.md')

const b1 = await parallel([predikt, vertex, aether])
const b2 = await parallel([huddle, cipher, websites])
const sections = [...b1, ...b2].filter(Boolean)

// ---------- Phase 2: synthesize ----------
phase('Synthesize')
log('Merge sections -> master INVENTORY.md + per-app gap analysis + root README.')
const synth = await agent(`Synthesize the master ${ROOT}/INVENTORY.md from the six section files in ${SECT}/ (1-predikt.md ... 6-websites.md — read them all).
Structure:
1) Overview: the 6 products (Predikt, Vertex, Aether Wallet, Huddle, Cipher, Websites) — one line each on what it is + platform.
2) Per-app INVENTORY sections: for each app, its grouped PAGES, APIs/endpoints (with counts), FUNCTIONALITY, and FEATURES — pulled from its section, deduped, concise + scannable.
3) Per-app GAP ANALYSIS ("what we're missing"): a table per app by relevant area with Have ✅ / Partial 🟡 / Missing ❌ + one honest line. For Predikt use areas: Trading, Liquidity, Markets/creation, Onboarding/wallet, Social/creator, Distribution, Mobile, Trust/compliance, Payments/on-ramp, Analytics/ops. For the games: Content/modes, Progression, Social/online, Monetization, Retention/LiveOps, Polish. For the wallet: Chains, Swap/DeFi, NFT, Account-abstraction/social-login, Security, On/off-ramp, UX. For Huddle: Messaging, Voice/video, Search, Admin, Notifications, Scale. For Websites: legal/support completeness per app.
4) A cross-app "Top gaps to close next" prioritized list (10-15 items across all apps).
Keep it scannable (tables + short lines) — this is the doc for deciding what to build next.
Then update/create ${ROOT}/README.md as a MASTER index: list ALL 6 products (name, one line, path, platform, status) + link to INVENTORY.md and each app's own README. Also add an INVENTORY.md pointer to ${ROOT}/prediction/README.md.
Finally, delete the ${SECT}/ temp dir.
Output: confirm INVENTORY.md written (list its section headers), the root README index created/updated, and the top gaps.`, { label: 'synthesize', phase: 'Synthesize', agentType: 'general-purpose' })

return { sections: sections.length, synth }
