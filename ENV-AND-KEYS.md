# Predikt — env & keys you need to fill in

Everything you must supply to run/deploy Predikt, grouped by component. **🔒 = private secret (never commit).** ⬜ = public value (safe). Every component ships a `.env.example` / `.env.local.template`; copy it to `.env` / `.env.local` and fill in. All committed values are safe local-dev defaults or public placeholders — replace them with yours.

---

## 1. Backend + database (the app's core) — `oracle/`
The app runs on Supabase + Firebase (Manifold's stack). See `oracle/web/docs/BACKEND-CONFIG.md`.

**Create these free-tier accounts:** [Supabase](https://supabase.com) project · [Firebase](https://console.firebase.google.com) project.

Set in `oracle/common/src/envs/prod.ts` (+ `dev.ts`) — the committed values are Manifold's placeholders and **auth breaks until replaced**:
- ⬜ `supabaseInstanceId` — your Supabase project ref
- ⬜ `supabaseAnonKey` — Supabase anon key (public, RLS-protected)
- 🔒 Supabase **service_role key** — admin/SSR (server env `DEV_ADMIN_SUPABASE_KEY` / prod secret)
- 🔒 Supabase **DB connection** — host/port/**password** (`SUPABASE_HOST/PORT/PASSWORD`)
- 🔒 `SUPABASE_JWT_SECRET`, `API_SECRET`, `SCHEDULER_AUTH_PASSWORD`
- ⬜ Firebase web config — `apiKey` (public, domain-locked) / `authDomain` / `projectId` / `appId` / `messagingSenderId` / `measurementId`
- 🔒 Firebase **service account JSON** (backend admin SDK) + **Apple sign-in** provider config (App Store requirement)

Backend templates: `oracle/backend/api/.env.local.template`, `oracle/backend/scheduler/.env.local.template`.

---

## 2. Web app — `oracle/web/.env.local`
- ⬜ `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_KEY` / `SUPABASE_URL` / `SUPABASE_KEY` — your Supabase project (prod) or local (`npx supabase start`)
- 🔒 `DEV_ADMIN_SUPABASE_KEY` — Supabase service_role (SSR)
- **AI market factory** — 🔒 `OPENROUTER_API_KEY` ([openrouter.ai](https://openrouter.ai), server-only) · ⬜ `NEXT_PUBLIC_AI_MODEL` (default free Llama) · ⬜ `OPENROUTER_SITE_URL` / `OPENROUTER_SITE_NAME`
- **On-chain (all ⬜ PUBLIC addresses — see §5):** `NEXT_PUBLIC_ONCHAIN_UMA_ADAPTER`, `_EXCHANGE`, `_CONDITIONAL_TOKENS`, `_UMA_OPTIMISTIC_ORACLE`, `_USDC` (optional), `_FPMM_FACTORY`, `_RELAY_URL`
- **Jurisdiction (optional ⬜):** `NEXT_PUBLIC_ONCHAIN_BLOCKED_REGIONS` / `NEXT_PUBLIC_ONCHAIN_ALLOWED_REGIONS` (ISO-3166 codes)
- **Gasless (optional):** ⬜ `NEXT_PUBLIC_PAYMASTER_URL` (free-tier ERC-4337 paymaster)

---

## 3. Mobile app — `oracle/native`
See `oracle/native/FIREBASE-SETUP.md`. Run `npx expo prebuild --clean` before building.
- ⬜ `EXPO_PUBLIC_WEB_DOMAIN` / `EXPO_PUBLIC_WEB_URL` — your deployed Predikt web URL (required for WebView/deep-links/OTA)
- ⬜ `EAS_PROJECT_ID` (run `eas init`) · ⬜ `EAS_OWNER` (your Expo account)
- 🔒 **Firebase config files** — your own `google-services.json` (Android, package `com.predikt.app`) + `GoogleService-Info.plist` (iOS, bundle `com.predikt.app`) into `configs/{dev,prod}/`
- 🔒 `EXPO_PUBLIC_SENTRY_DSN` (optional) + ⬜ `EAS`/Sentry org
- Replace app icons/splash in `assets/` with real Predikt art
- Accounts: Apple Developer, Google Play, Expo/EAS

---

## 4. On-chain relay + market maker — `predikt-relay/.env`
- ⬜ `PORT`, `SUBMIT_RATE_LIMIT_PER_MIN`, `READ_RATE_LIMIT_PER_MIN`, `TRUST_PROXY`
- ⬜ `RELAY_ALLOWED_ORIGINS` — your app origin(s) (never `*`)
- ⬜ `CHAIN_ID` (137 Polygon) · 🔒 `RPC_URL` (your RPC — [Alchemy](https://alchemy.com)/[Infura](https://infura.io) free tier, or public)
- ⬜ `EXCHANGE_ADDRESS` / `USDC_ADDRESS` / `CTF_ADDRESS` (from §5 deploy)
- 🔒 `OPERATOR_PK` — the relay operator EOA key (granted the exchange operator role via `addOperator`)
- ⬜ `DATABASE_PATH`, `START_BLOCK`
- **Market maker (`npm run mm`):** 🔒 `MM_PRIVATE_KEY` (funded maker EOA — USDC) · ⬜ `MM_MARKETS`, `MM_SPREAD_BPS`, `MM_ORDER_SIZE`, `MM_LEVELS`, `MM_REFRESH_MS`

---

## 5. Contracts deploy — `predikt-contracts/`
Deploy each with its own forge script (or `deploy-kit`). See `predikt-contracts/DEPLOY.md`.
- **ctf-exchange** (`.env`): 🔒 `PK` (deployer key) · ⬜ `ADMIN`, `RPC_URL`, `COLLATERAL` (native USDC), `CTF`, `PROXY_FACTORY`, `SAFE_FACTORY`
- **uma-ctf-adapter** (`.env`): 🔒 `PK` · ⬜ `CTF`, `FINDER`, `OPTIMISTIC_ORACLE`, `RPC_URL` · ⬜ `ETHERSCAN_API_KEY` (Polygonscan, for verify)
- **deploy-kit**: 🔒 `PRIVATE_KEY` · ⬜ `RPC`, `--chain amoy|polygon`
- Real Polygon primitive addresses (ConditionalTokens/USDC/UMA) are documented in `DEPLOY.md`.
- (`clob-client/.env` — the hosted-CLOB SDK client; NOT needed since we self-host the relay.)

---

## 6. Bots / distribution
- **liquify** (off-chain MM) + **autopilot** (trader) — `.env`: 🔒 `MANIFOLD_API_KEY` (your Predikt account API key, from Profile → API key) · ⬜ `MANIFOLD_USERNAME` · ⬜ `ORACLE_API_URL` (optional) · autopilot: ⬜ `MANIFOLD_MARKET_SLUG`
- **herald** (Discord) — `.env`: 🔒 `DISCORD_BOT_TOKEN`, ⬜ `DISCORD_CLIENT_ID` ([Discord dev portal](https://discord.com/developers)) · ⬜ `ORACLE_API_URL` · 🔒 `ORACLE_API_KEY` (fallback)
- **relay-tg** (Telegram) — `.env`: 🔒 `BOT_TOKEN` ([@BotFather](https://t.me/BotFather)) · ⬜ `ORACLE_API_URL` · 🔒 `ORACLE_API_KEY` (fallback)
- Bots store per-user keys in `keys.json` (gitignored, plaintext — keep the dir private).

---

## Free-tier accounts summary
Supabase · Firebase · OpenRouter · an EVM RPC (Alchemy/Infura) · Expo/EAS · Apple Developer · Google Play · Discord + Telegram bots · Polygonscan (verify). Plus a funded EVM wallet (USDC on Polygon) for the operator + market maker to go on-chain.

**Nothing in this repo is a real private secret** — committed values are safe local defaults / public placeholders / public contract addresses. Fill your own into the `.env` files (which are gitignored).
