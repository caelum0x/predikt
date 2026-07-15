> ## 🔮 Predikt Oracle — OKX.AI Genesis Hackathon ASP
>
> This repo also contains **Predikt Oracle**, a prediction market rebuilt
> **agent-native** as an Agentic Service Provider (ASP) for the
> [OKX.AI Genesis Hackathon](https://www.hackquest.io/hackathons/OKXAI-Genesis-Hackathon).
> Agents create markets, trade probabilities via a CPMM, rest limit orders,
> deposit USDT over **x402**, earn Brier-score reputation, and settle with
> payouts — over HTTP **or** a native MCP server. `294 tests`, two adversarial
> security reviews.
>
> → **[`asp/`](asp/)** · **[asp/README.md](asp/README.md)** · demo videos in
> **[`submission/demo-video/`](submission/demo-video/)** · listing copy in
> **[`submission/listing.md`](submission/listing.md)**
>
> The original Polymarket-style stack that Predikt Oracle was derived from
> follows below.

---

# Predikt

**A Polymarket-style prediction market — web + mobile, play-money *and* real trustless on-chain USDC, in one product.**

Built on the open-source Manifold app, extended with Polymarket's real on-chain stack (used directly, not reimplemented). Off-chain markets use play money and work out of the box. On-chain markets settle in USDC, trade through a hybrid AMM + signed-order CLOB, and resolve trustlessly via UMA's optimistic oracle — no admin can flip the result.

> Part of the workspace of six products. See the master **[../INVENTORY.md](../INVENTORY.md)** (per-app pages/APIs/features + gap analysis) and the **[../README.md](../README.md)** index.

## The edge (why this beats Polymarket & Kalshi)
Kalshi is US-only fiat with gatekept markets; Polymarket is crypto-only and US-banned. Neither can become the other. Predikt runs **both money modes, toggled per market** — free play money (global, no-KYC, permissionless creation, viral) as the top of funnel → trustless on-chain USDC for real stakes. See **`ROADMAP.md`**.

---

## What's in this repo

| Folder | What it is |
|---|---|
| **oracle/** | The app. Manifold web app (Next.js + Supabase) reskinned to a clean dark Polymarket UI, brand **Predikt**. Includes the **AI market factory**, creator economy, follow/copy-trade, embeds, jurisdiction routing, and the on-chain trade box + order book. `oracle/native/` = the Expo mobile shell (wraps the web app + push). |
| **predikt-contracts/** | The on-chain layer, all real OSS made ours (MIT): `@predikt/ctf-exchange` (trading), `@predikt/uma-ctf-adapter` (UMA settlement), `@predikt/orders` (EIP-712 signing), `fpmm/` (Gnosis AMM, LGPL — deployed standalone). Plus `DEPLOY.md` + `deploy-kit/`. |
| **predikt-relay/** | The CLOB **operator**: stores signed orders, matches them, settles on-chain via `CTFExchange.matchOrders`. `src/marketmaker/` seeds two-sided on-chain liquidity. |
| **demo/** | **One command** (`npm run demo`) boots the whole on-chain stack on anvil (all contracts + AMM + relay + market maker + a seeded market) and runs a router self-check. |
| **liquify/** · **autopilot/** | Off-chain market-maker + trader bots (Manifold `market-maker` / `simple-trader`, MIT). |
| **herald/** · **relay-tg/** | Discord + Telegram bots (register / view / bet / create). |

---

## Feature set (all real, verified)
- **Trading** — off-chain CPMM (play money) + on-chain **hybrid liquidity**: Gnosis **FPMM AMM** (always-liquid long tail) **+** a signed-order **CLOB** (tight top-of-book), with a client **best-execution router** that quotes both and picks the better venue.
- **Trustless settlement** — Gnosis Conditional Tokens + **UMA Optimistic Oracle** (dispute-based); redeem winning USDC on-chain.
- **Market factory** — permissionless creation, all market types (Yes/No, multi, numeric, date, poll), **AI drafting from a topic/news** (OpenRouter, key server-side), resolution assistant, client-side parlays.
- **Onboarding** — instant play, auto-provisioned embedded wallet (crypto invisible), social login (Google + Apple), documented gasless seam.
- **Social / distribution** — creator earnings, follow + copy-trading, calibration/reputation, embeddable widgets, Discord + Telegram bots.
- **Trust / regulatory** — on-chain resolution status + verify links, jurisdiction-aware money-mode routing (play money always the safe default; "not legal advice").
- **Mobile** — Expo WebView shell (`com.predikt.app`) wrapping the web app + full push-notification pipeline.

---

## Run it (local dev)

```bash
# The app (needs your Supabase/Firebase env — see oracle/web/docs/BACKEND-CONFIG.md)
cd oracle/web && yarn && yarn dev

# On-chain, proven end-to-end on a local chain (no deploy needed)
cd predikt-relay && npm install && npm run e2e        # deploy → sign → match → fill → redeem, asserts on-chain

# The WHOLE on-chain stack, live, in one command (anvil + contracts + AMM + relay + MM + seeded market)
cd demo && npm run demo                                # prints the .env.local block to point the app at it
```

## Go live on-chain (you deploy; contracts are ready)
Full steps in **`predikt-contracts/DEPLOY.md`** (or the guided `predikt-contracts/deploy-kit/`):
1. Deploy `ctf-exchange` + `uma-ctf-adapter` with their **own** forge scripts → Amoy, then Polygon (`COLLATERAL` = native USDC).
2. Run the **relay** with an operator key → grant it the exchange operator role (`addOperator`).
3. Run the **market maker** (`predikt-relay: npm run mm`) with a funded wallet.
4. Set the app's `NEXT_PUBLIC_ONCHAIN_*` + `_RELAY_URL` env → on-chain markets go live.

## Configure it
**`ENV-AND-KEYS.md`** lists every env var / key per component (🔒 secret vs ⬜ public, where to get each). Also: `oracle/web/docs/BACKEND-CONFIG.md` (Supabase/Firebase), `oracle/native/FIREBASE-SETUP.md` (mobile), `predikt-relay/MARKETMAKER.md`.

---

## Verification status (honest)
- ✅ `forge test` (contracts) green (150+) · `@predikt/orders` 318 tests · `oracle/web` + `predikt-relay` `tsc` clean · relay security review = testnet-GO · **full on-chain flow proven on anvil** (CLOB e2e 21/21, AMM e2e 18/18, one-command demo 20/20 incl. a real router-chosen fill).
- ⚠️ Not done in this environment: deploying to a real chain, booting the Next.js server, and building the native app (needs your accounts/keys/simulator). Those are yours — `demo/` lets you watch it all locally first.

## Licenses
Manifold (oracle), Polymarket contracts (`ctf-exchange`, `uma-ctf-adapter`, `clob-client`→`@predikt/orders`), and the bots are **MIT**. The Gnosis **FPMM** (`fpmm/`) is **LGPL-3.0** (deployed standalone, called by ABI — not bundled into the app). Gnosis Conditional Tokens + USDC + UMA are called at their already-deployed addresses.

_No real private secrets are committed — see `ENV-AND-KEYS.md`._
