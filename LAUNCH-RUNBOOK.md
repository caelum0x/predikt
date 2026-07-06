# Predikt — Launch Runbook (testnet → mainnet)

The exact sequence to take Predikt live. Get your keys ready first from **`ENV-AND-KEYS.md`**. Do every step on **Amoy testnet** before Polygon mainnet.

---

## Phase 0 — Prove it locally (no accounts needed)
```bash
cd predikt-relay && npm install && npm run e2e     # on-chain flow: deploy→sign→match→fill→redeem (asserts)
cd ../demo && npm run demo                          # whole stack on anvil + prints the .env.local block
```
✅ Gate: both pass with on-chain assertions.

---

## Phase 1 — Backend + web app
1. **Supabase** (free): create a project → run the migrations in `oracle/backend/supabase/` → copy the project ref + anon key + service_role key.
2. **Firebase** (free): create a project → enable Auth (Google + **Apple** — required for iOS) → copy the web config; download the service account for the backend.
3. Set the real values in `oracle/common/src/envs/{prod,dev}.ts` (replace the upstream placeholders) — see `oracle/web/docs/BACKEND-CONFIG.md`.
4. Deploy the web app (Vercel/your host) with the `oracle/web/.env.local` values.
✅ Gate: sign in works, markets load, an **off-chain** (play-money) bet places + resolves.

---

## Phase 2 — Contracts on **Amoy testnet** (80002)
Use the guided kit (wraps each repo's own forge script):
```bash
cd predikt-contracts/deploy-kit
# env: PRIVATE_KEY (funded Amoy key), RPC
node deploy.mjs --chain amoy            # deploys CTFExchange + UmaCtfAdapter + FPMM factory, grants operator, writes addresses.amoy.json
```
- It prints env blocks for `oracle/web`, `predikt-relay`, and the market maker.
- Amoy addresses for ConditionalTokens/USDC/UMA are in `predikt-contracts/DEPLOY.md` — **verify the Amoy CTF address on amoy.polygonscan.com** (it's from a third-party mirror).
- Start the relay (`predikt-relay`: set `.env`, `npm start`) + market maker (`npm run mm`) against Amoy.
- Set `oracle/web` `NEXT_PUBLIC_ONCHAIN_*` + `_RELAY_URL` → on-chain markets appear.
✅ Gate: create an on-chain market, connect the embedded wallet, buy YES (router picks AMM/CLOB), it fills on-chain, resolve via UMA, **redeem USDC**.

---

## Phase 3 — Contracts on **Polygon mainnet** (137)
> ⚠️ Real money. Do the **contract fork audit** first (audit dirs are upstream Polymarket's; your fork is unaudited). Start with small liquidity.
```bash
cd predikt-contracts/deploy-kit
node deploy.mjs --chain polygon          # COLLATERAL = native USDC 0x3c49…3359 (must match the app)
```
- Fund the **operator** wallet (gas) + the **market-maker** wallet (USDC) — modest amounts first.
- Run relay + MM against Polygon; set the app's mainnet `NEXT_PUBLIC_ONCHAIN_*`.
- Harden the relay: put it behind HTTPS + a reverse proxy (`TRUST_PROXY`), set `RELAY_ALLOWED_ORIGINS` to your domain, back up the SQLite order DB.
✅ Gate: a small real-USDC round-trip (buy → fill → resolve → redeem) on mainnet.

---

## Phase 4 — Mobile (App Store + Play)
1. Create a **Predikt Firebase project** → drop `google-services.json` + `GoogleService-Info.plist` into `oracle/native/configs/{dev,prod}/` (package/bundle = `com.predikt.app`) — see `oracle/native/FIREBASE-SETUP.md`.
2. `cd oracle/native` → set `EXPO_PUBLIC_WEB_URL` (your deployed web app) + `EAS_PROJECT_ID` (`eas init`) + `EAS_OWNER`.
3. Replace `assets/` icon/splash with real Predikt art → `npx expo prebuild --clean` → `eas build` (dev first, then production) → `eas submit`.
✅ Gate: install on a device, push notification arrives, deep link opens a market, trade works.

---

## Phase 5 — Go-live checklist
- [ ] Predikt **compliance site** live (privacy/terms/support/delete) with a **monitored support inbox** (replace the `.example` placeholder).
- [ ] Contract fork **audited**; mainnet addresses committed to prod env.
- [ ] Relay behind HTTPS + rate limits + CORS locked to your origin; order-DB backups.
- [ ] Bot key secret (`KEY_ENCRYPTION_SECRET`) set for herald/relay-tg.
- [ ] Monitoring: relay health, RPC, scheduler; error tracking (Sentry).
- [ ] Jurisdiction blocklist (`NEXT_PUBLIC_ONCHAIN_BLOCKED_REGIONS`) set per your legal counsel.
- [ ] App Store metadata: Sign in with Apple ✅, privacy nutrition labels, support + delete URLs → the compliance site.

**Rollback:** on-chain features are env-gated — unset `NEXT_PUBLIC_ONCHAIN_*` to instantly fall back to the off-chain play-money app with zero on-chain exposure.
