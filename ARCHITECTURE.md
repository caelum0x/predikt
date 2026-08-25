# Predikt — Enterprise Architecture & Growth Plan

> **Planning document.** No code is changed by this doc. It reads the repo as-is and proposes a
> target enterprise structure, a graph-engineering layer, an OSS foundation, an open-source /
> commercial verdict, and an honest growth path for a solo founder.
>
> Scope read: `/Users/arhansubasi/products/predikt` (current product) and
> `/Users/arhansubasi/products/prediction` (older split source tree of the same family, for context).

---

## 1. What it is + current state

### 1.1 What Predikt predicts

Predikt is a **Polymarket-style prediction market** — a two-sided marketplace where users trade on the
outcome of **future real-world events**: elections/politics, sports, crypto/finance, news, and
user-created questions of any kind. It is **not** a single-vertical forecaster; it is a
**permissionless market venue** where anyone can create a market on any event and the crowd's trading
prices become the forecast. Markets resolve to a settled outcome and winners are paid.

The defining product bet (from `README.md` / `ROADMAP.md`) is **dual money-mode in one product**:

- **Play money** — global, no-KYC, permissionless, instant-guest — the viral top of funnel.
- **On-chain USDC** — real, trustless stakes settled on Polygon, resolved by **UMA's optimistic
  oracle** (no admin can flip the result).

The wedge: Kalshi is US-only fiat with gatekept markets; Polymarket is crypto-only and US-banned.
Neither can become the other. Predikt runs **both modes, toggled per market**, and routes users to the
legal mode for their jurisdiction automatically.

### 1.2 Stack (real, verified from the tree)

| Layer | Technology | Where |
|---|---|---|
| Web app | **Next.js (pages router) + React + TypeScript + Tailwind** | `oracle/web` (924 files, ~180K LOC; 117 pages, 548 components) |
| Backend | **Supabase (Postgres + RLS) + Firebase Auth + Google Cloud Functions** (Manifold's API + scheduler) | `oracle/backend` (~94K LOC) |
| Shared domain | Isomorphic TS domain logic (bets, CPMM math, contracts, users) | `oracle/common` (~76K LOC) |
| Mobile | **Expo / React Native WebView shell** wrapping the web app + FCM push | `oracle/native` (Predikt shell), `oracle/mani` (older full native) |
| On-chain contracts | **Solidity / Foundry** — CTF Exchange (CLOB), UMA-CTF Adapter, Gnosis FPMM (AMM) | `predikt-contracts/*` (~7.4K Solidity LOC) |
| Order signing SDK | **EIP-712 signer** `@predikt/orders` | `predikt-contracts/clob-client/src` (~2K LOC, 318 tests) |
| CLOB operator | **Express + viem + SQLite** relay (stores signed orders, matches, settles on-chain) | `predikt-relay` (~3.1K LOC, 22 files) |
| Off-chain bots | Market-maker `liquify`, trader `autopilot` | `liquify` (412), `autopilot` (312) |
| Distribution bots | **Discord** `herald`, **Telegram** `relay-tg`, **Twitch** `oracle/twitch-bot` | ~7.8K LOC combined |
| AI market factory | **OpenRouter** (server-side key) + **Zod** validation | `oracle/web/lib/ai` + `pages/api/ai/*` |

Approx. total **~375K LOC** across the workspace (majority inherited from Manifold; see §7).

### 1.3 The real, Predikt-specific modules (the delta over upstream)

Most of `oracle/` is the **Manifold** app (MIT) reskinned to a dark Polymarket look. The genuinely
**net-new engineering** that makes Predikt distinct lives in a much smaller, higher-value surface:

- **`oracle/web/lib/onchain/`** (~7.6K LOC incl. ai/compliance/parlay) — the on-chain layer:
  - `router.ts` — **best-execution router**: quotes the **CLOB** (walks real relay book depth) and the
    **AMM** (real `calcBuyAmount` / inverted `calcSellAmount` view calls), picks the venue that gives
    the trader more, and `execute()`s the winner (EIP-712 order to relay, or on-chain AMM tx). Reports
    `venue:'none'` instead of faking a fill.
  - `amm.ts`, `orders.ts`, `settlement.ts`, `resolution.ts`, `market.ts`, `registry.ts`,
    `evmClient.ts`, `gasless.ts`, `chains.ts`, `addresses.ts` + ABIs.
  - **`lib/ai/`** — the AI market factory: `openrouter.ts` client, `schema.ts` (Zod, model output
    never trusted raw), `prompts.ts`, `rate-limit.ts`; routes `draft-market.ts`, `suggest-resolution.ts`.
  - **`lib/compliance/jurisdiction.ts`** — pure, testable money-mode routing by ISO-3166 region.
  - **`lib/parlay/`** — client-side combinatorial parlays.
- **`predikt-relay/`** — the CLOB **operator**: `engine.ts` (validate signed order → match → settle via
  `CTFExchange.matchOrders`), `book/` (book + matcher), `chain/` (exchange + event indexer), `store/`
  (SQLite), `marketmaker/` (two-sided on-chain liquidity seeding), Express API (`/orders`, `/book`,
  `/trades`, `/health`).
- **`predikt-contracts/`** — the forked on-chain stack made MIT-ours: `ctf-exchange` (signed-order
  settlement + `Fees` mixin), `uma-ctf-adapter` (trustless resolution), `fpmm` (LGPL AMM, deployed
  standalone), `@predikt/orders`.
- **Distribution bots** and the **Expo shell**.

### 1.4 Honest maturity

| Area | State |
|---|---|
| Off-chain play-money app | **Inherited & working** (Manifold, battle-tested). Reskin done. |
| On-chain contracts | `forge test` green (150+); **fork is unaudited** (audit dirs are upstream Polymarket's). |
| CLOB relay | `tsc` clean; security review = **testnet-GO**; full flow proven on **anvil** (CLOB e2e 21/21, AMM 18/18, one-command demo 20/20 with a real router-chosen fill). |
| AI market factory | Built, Zod-validated, rate-limited. |
| Deployed to a real chain / real users | **No.** Never booted the Next.js server in-env, never deployed contracts to Amoy/Polygon, native app never built. Those need the founder's accounts/keys. |
| **Overall** | **A very complete, verified-local pre-launch build.** Engineering is far ahead of *distribution*. Zero users, zero liquidity, zero revenue. The gap is go-to-market, not code. |

---

## 2. Target enterprise structure

The current layout is a **flat multi-repo-in-one-folder** (`oracle/`, `predikt-relay/`,
`predikt-contracts/`, bots) that grew organically around the Manifold fork. At enterprise scale the
goal is a **clear monorepo with a bounded on-chain domain, a services tier, and shared packages** —
without a rewrite. Below is the target tree, grounded in what already exists (✅ = exists today,
→ = extract/refactor from existing, ✨ = new).

```
predikt/
├── apps/
│   ├── web/                          ✅ oracle/web — Next.js trading app
│   │   ├── pages/                    ✅ 117 pages (markets, create, portfolio, leagues…)
│   │   │   └── api/
│   │   │       ├── ai/               ✅ draft-market, suggest-resolution
│   │   │       ├── onchain/          ✨ relay proxy, quote cache, resolution webhook
│   │   │       └── og/               ✅ social share images
│   │   ├── components/
│   │   │   ├── onchain/              ✅ trade-box, order-book, resolution-status, transparency
│   │   │   ├── contract/ create/ bet/ portfolio/ …   ✅ (548 components — group by domain)
│   │   │   └── compliance/           ✅ jurisdiction banners, "not legal advice"
│   │   ├── lib/  → moved to packages/  (see below)
│   │   └── middleware.ts             ✅ edge geo → region cookie/header
│   ├── native/                       ✅ oracle/native — Expo WebView shell + push
│   └── admin/                        → extract oracle/web/components/admin into its own surface
│                                       (market curation, resolution review, dispute ops, moderation)
│
├── services/
│   ├── relay/                        ✅ predikt-relay — CLOB operator
│   │   ├── src/{api,book,chain,store,marketmaker,config}   ✅
│   │   ├── src/risk/                 ✨ position/exposure limits, circuit breakers, MM PnL guard
│   │   └── src/observability/        ✨ metrics, structured audit log, alerting hooks
│   ├── scheduler/                    ✅ oracle/backend/scheduler — close/resolve/payout cron
│   ├── api/                          ✅ oracle/backend/api — Manifold cloud functions
│   ├── resolver/                     ✨ resolution orchestrator (see task graph §3.4):
│   │                                    close → AI proposal → UMA request → dispute watch → settle
│   ├── market-factory/              → promote lib/ai into a service (news ingest → drafts → publish)
│   ├── indexer/                     → extract relay chain/indexer into a standalone graph feeder (§3)
│   └── bots/
│       ├── liquify/  autopilot/     ✅ off-chain MM + trader
│       ├── herald/ (Discord)        ✅
│       ├── relay-tg/ (Telegram)     ✅
│       └── twitch/                  ✅
│
├── contracts/                        ✅ predikt-contracts
│   ├── ctf-exchange/                 ✅ CLOB settlement (MIT)
│   ├── uma-ctf-adapter/              ✅ trustless resolution (MIT)
│   ├── fpmm/                         ✅ AMM (LGPL — standalone, ABI-called)
│   ├── deploy-kit/                   ✅ guided multi-chain deploy
│   └── audit/                        ✨ fork audit reports (required before mainnet §5)
│
├── packages/                         ✨ extract shared libs from oracle/web/lib + oracle/common
│   ├── onchain-sdk/                 → lib/onchain (router, amm, orders, settlement, resolution)
│   ├── orders/                       ✅ @predikt/orders — EIP-712 signer
│   ├── ai-factory/                  → lib/ai (schema, prompts, openrouter, rate-limit)
│   ├── compliance/                  → lib/compliance/jurisdiction (pure, reusable)
│   ├── parlay/                      → lib/parlay
│   ├── domain/                      → oracle/common (bets, CPMM math, contract/user models)
│   ├── graph/                        ✨ knowledge-graph client + ontology (§3)
│   └── ui/                          → shared Predikt design system (reskin tokens)
│
├── graph/                            ✨ the domain knowledge graph (§3)
│   ├── ontology.yaml                 ✨ single source of truth (entities, relations, events)
│   ├── extractors/                   ✨ per-source mappers (DB→graph, news→events)
│   ├── fusion/                       ✨ blocking / matching / merge for entity resolution
│   └── serving/                      ✨ GraphRAG retrieval for AI factory + resolver
│
├── infra/                            ✨ IaC: Vercel, relay host, Postgres, RPC, secrets, monitoring
│   ├── terraform/  docker/  k8s/
│   └── runbooks/                    → LAUNCH-RUNBOOK.md, DEPLOY.md
│
├── docs/                             ✅ oracle/docs (Docusaurus) + this file
└── demo/                             ✅ one-command anvil stack (contracts+AMM+relay+MM+seeded market)
```

**Rationale for the move set**

- **`packages/` extraction** is the single highest-leverage refactor: the Predikt-specific value
  (onchain-sdk, ai-factory, compliance, orders) is buried inside a 180K-LOC Manifold fork. Extracting it
  makes it testable in isolation, reusable by the bots/relay/native, and — critically for §5 —
  **sellable/licensable independently** of the GPL-adjacent app fork.
- **`services/resolver` + `services/market-factory`** promote the two flows that are currently
  request-handlers (`pages/api/ai/*`) into first-class, independently-scalable services with their own
  task graphs (§3).
- **`services/indexer` + `graph/`** add the missing analytical/knowledge tier — today there is no
  cross-market entity model; §3 fixes that.
- **`apps/admin`** separates privileged resolution/moderation ops from the public app (security boundary).

---

## 3. Graph engineering

Two graphs, per the graph-engineering skill: a **domain knowledge graph** (what Predikt *knows* about
markets, events, people, and outcomes over time) and **task graphs** (how Predikt's flows *execute*).
Both carry **time + provenance on every edge** — mandatory here because prediction is inherently
temporal (prices, positions, and resolutions all change) and trustless resolution demands auditable
sources.

### 3.1 Why Predikt needs a knowledge graph

Today each market is an island. A knowledge graph turns the platform into a connected forecast engine:

- **De-duplicate & cluster markets** — "Will Trump win 2024?" created 40 times → one canonical
  `Event` with 40 `Market` children (fusion, §3.3). This alone fixes the #1 UX problem of
  permissionless creation.
- **Feed the AI factory** — GraphRAG retrieval of related events/resolutions makes generated markets
  non-duplicative and better-scoped.
- **Feed the resolver** — pull the event's `ResolutionSource` history + prior UMA disputes as context.
- **Power discovery & copy-trading** — "traders calibrated on `Politics` events," "markets correlated
  with this one," parlays over conditionally-linked events.
- **Correlation risk for the market-maker** — the MM bot should not seed two markets that are the same
  event under different wording.

### 3.2 Domain ontology (competency-question driven)

**Competency questions** (the spec + test suite):

1. Which markets are the same real-world **event** under different wording?
2. What **sources** resolved event X, and were any **disputed** on UMA?
3. Which **creators**' markets have the best **calibration** in `Politics`?
4. What **positions** does user U hold across correlated events, and what is their net exposure?
5. Which **news events** in the last 24h have no market yet (a factory opportunity)?
6. What is the **provenance chain** from a redeemed USDC payout back to the UMA answer and its data source?

**Entities** (canonical-form rule in `ontology.yaml`):

| Entity | Definition | Key attrs |
|---|---|---|
| `Event` | A real-world happening a market is *about* (canonical) | title, category, expected_date |
| `Market` | A tradeable question on an `Event` | slug, outcomeType, moneyMode, closeTime |
| `Outcome` | A resolvable result of a `Market` (YES/NO/answer) | index, label |
| `Condition` | On-chain conditionId (Gnosis CTF) | conditionId, questionId |
| `User` | A trader/creator | handle, calibration_score |
| `Wallet` | On-chain address (embedded or external) | address, chainId |
| `Position` | A user's holding in an outcome | shares, avgPrice |
| `Order` | A signed EIP-712 CLOB order | hash, side, price, maker |
| `Fill` | A settled match | txHash, shares, price |
| `LiquidityPool` | An FPMM AMM pool for a condition | poolAddr, reserves |
| `ResolutionSource` | A cited source of truth (URL/API) | url, publisher |
| `OracleRequest` | A UMA optimistic-oracle request | requestId, ancillaryData |
| `Dispute` | A UMA dispute event | disputer, bond, outcome |
| `Jurisdiction` | ISO-3166 region + allowed money modes | code, onChainAllowed |
| `Topic` | Category/tag | slug |

**Relations** (precise verbs, domain→range, all with `{since, until, source, confidence}`):

```
Market      ABOUT            Event
Market      HAS_OUTCOME      Outcome
Market      MAPS_TO          Condition           (on-chain link)
Market      CREATED_BY       User
Market      PRICED_BY        LiquidityPool       (AMM venue)
Order       ON               Outcome
Fill        MATCHES          Order (maker/taker)
User        HOLDS            Position -> Outcome
Position    IN               Market
Condition   RESOLVED_BY      OracleRequest
OracleRequest CITES          ResolutionSource
OracleRequest DISPUTED_BY    Dispute
Event       DEPENDS_ON       Event                (conditional / parlay linkage)
Event       CATEGORIZED_AS   Topic
Market      TRADEABLE_IN     Jurisdiction         (money-mode routing)
User        CALIBRATED_ON    Topic  {score}
```

**Events (first-class nodes, not flattened edges)** — the domain is dynamic:

```
Trade       {trigger: fill,        args: [user, outcome, shares, price, venue, txHash, t]}
Resolution  {trigger: settle,      args: [market, outcome, source, umaRequest, t]}
DisputeRaised {trigger: UMA dispute, args: [oracleRequest, disputer, bond, t]}
NewsEvent   {trigger: ingested article, args: [headline, entities, publisher, url, t]}
MarketCreated {trigger: create,    args: [market, creator, event, t]}
```

Store as a **property graph** (default per the skill; Kùzu/Neo4j, or typed edges in Postgres/SQLite at
<50K nodes — Predikt starts here). An **event-logic sub-graph** (事理图谱) linking `NewsEvent →
MarketCreated → Resolution` answers "what leads to what" for the factory's opportunity detection (Q5).

### 3.3 Extraction & fusion pipeline

Match method to source (never NLP on structured data):

- **Structured (the bulk)** — `Market`, `Order`, `Fill`, `Position`, `Condition` come **directly** from
  Supabase + the relay SQLite + on-chain events via `services/indexer`. Deterministic column→ontology
  mapping, no LLM. This is 90% of the graph and is 100%-precision.
- **Semi-structured** — UMA `ancillaryData`, resolution criteria text → parsers + LLM only for messy
  cells.
- **Unstructured** — news articles for the factory → NER → relation → **event** extraction with the
  ontology in the prompt and **evidence-quote required** (kills co-occurrence hallucination).

**Fusion** (the make-or-break stage) resolves the duplicate-markets problem:

1. **Blocking** — group `Market` candidates by embedding similarity + shared tokens + same category
   before comparing (never O(n²)).
2. **Matching** — string layer (normalized question) + attribute layer (close date, outcome type) +
   **structure layer** (same creator neighborhood? same cited sources? correlated price history?) →
   LLM adjudication only for the ambiguous middle band.
3. **Merge policy** — deterministic: canonical `Event`, union child markets, keep conflicting
   attributes with provenance, record `merged_from` for undo. Auto-merge only above high confidence;
   an erroneous merge silently fuses two events' whole edge sets, so bias toward *missed* merges.

### 3.4 Task graphs for the core flows

**Flow A — AI market factory (news → published market).** Diamond pattern with a separate verifier:

```
                    ┌─ draft: BINARY ──┐
news/topic ─→ GraphRAG ─┼─ draft: MULTI ───┼─→ verify (Zod schema  ─→ dedupe vs Event ─→ [human gate] ─→ create
 (retrieve related      └─ draft: NUMERIC ─┘   + resolvability +      graph (fusion)      publish
  Events + prior             (parallel          jurisdiction)          │
  resolutions)                fan-out)          separate context ──────┘
```

- Fan-out drafts run in parallel (independent — a fake "and-then" if serialized).
- **Verify in a separate context**: `schema.ts` Zod validation already exists; add a *resolvability*
  check (is there a citable source that will settle this?) and a *duplicate* check against the graph.
- **Human gate** before publish for on-chain markets (irreversible: creates a `Condition`); play-money
  drafts can auto-publish under a rate limit.

**Flow B — Resolution & settlement (close → payout).** The critical, mostly-irreversible flow:

```
market closes ─→ AI resolution proposal (suggest-resolution.ts, cited)
                     │
                     ├─ play-money → creator/mod verify [human gate] ─→ settle off-chain ─→ payout
                     │
                     └─ on-chain → UmaCtfAdapter.initialize/request
                                      ─→ UMA proposal ─→ **dispute window watch** (services/resolver)
                                            ├─ undisputed ─→ settle Condition ─→ users redeem USDC
                                            └─ disputed  ─→ record Dispute ─→ UMA DVM vote ─→ settle
```

- The dispute window is a **timed loop with a max-rounds cap** (guardrail); the resolver polls UMA.
- Every `Resolution` writes a **provenance chain** into the graph (Q6): payout → Fill → Condition →
  OracleRequest → ResolutionSource. This is the trust artifact that makes Predikt "credibly neutral."
- **Human gate placement**: on the *irreversible* edges only (on-chain settle, payout) — not on every
  price tick.

**Flow C — Best-execution trade (already built, `router.ts`).** A clean diamond:

```
quote request ─→ ┌─ quote AMM (calcBuy / inverted calcSell) ─┐
                 └─ quote CLOB (walk real relay book depth) ─┘─→ pickWinner ─→ execute (AMM tx | signed order) | venue:'none'
```

This is textbook parallel-fan-out + single-owner merge (`pickWinner`), and it already refuses to fake a
fill when neither venue can price — the correct "no-hallucination" behavior.

**Flow D — Market-maker seeding (`relay/marketmaker`).** Per new `Condition`: price → build two-sided
orders → submit → refresh loop (capped). Add a **graph correlation check** so the MM doesn't double-seed
the same `Event`.

---

## 4. OSS foundations

Predikt is already **built on excellent OSS** — the job here is to name the licenses honestly, confirm
the reuse-vs-build calls, and flag the one copyleft dependency.

### 4.1 What Predikt already forks (all verified in-tree)

| Component | Upstream | License | Fit / call |
|---|---|---|---|
| The whole app | **Manifold** (`oracle/`) | **MIT** ✅ | Reuse. Battle-tested prediction-market app, social + CPMM + creator economy for free. Best possible base. |
| CLOB settlement | **Polymarket `ctf-exchange`** | **MIT** ✅ | Reuse. Real signed-order exchange incl. `Fees` mixin. |
| Trustless resolution | **Polymarket `uma-ctf-adapter`** | **MIT** ✅ | Reuse. Don't reimplement optimistic-oracle glue. |
| Order signing | **Polymarket `clob-client`** → `@predikt/orders` | **MIT** ✅ | Reuse (already ported, 318 tests). |
| AMM | **Gnosis `FixedProductMarketMaker`** (`fpmm/`) | ⚠️ **LGPL-3.0** | Reuse **standalone** — deployed as its own contract, called by ABI, **not bundled** into app source. This is the correct way to consume LGPL and keep the app permissive. |
| Conditional Tokens, USDC, UMA OO | Gnosis / Circle / UMA | deployed primitives | Call at existing mainnet addresses. Build nothing. |

**GPL/AGPL flag:** the **only** copyleft is **Gnosis FPMM (LGPL-3.0)**. Handled correctly today
(standalone deploy + ABI call = no derivative-work obligation on the app). **Keep it that way** — never
import FPMM Solidity into a contract you also want permissively licensed. No AGPL anywhere (good — AGPL
in a hosted service would force you to open your server).

### 4.2 Recommended additions (fork/build-on, MIT/Apache-2.0)

For the enterprise tier, prefer battle-tested OSS over hand-rolling:

| Need | OSS to adopt | License | Reuse vs build |
|---|---|---|---|
| Knowledge graph store | **Kùzu** (embedded graph DB) or **Neo4j Community** | MIT / GPLv3* | Reuse Kùzu (MIT, embedded — no server). *Avoid Neo4j Community's GPLv3 for a hosted product. |
| Graph orchestration / task graphs | **LangGraph** | MIT | Build-on for the resolver + factory DAGs (§3.4). |
| On-chain indexing | **Ponder** or **Subsquid** | MIT / GPL-ish | Reuse **Ponder** (MIT) for `services/indexer` — replaces hand-rolled event polling. |
| Account abstraction / gasless | **ERC-4337 (permissionless.js / ZeroDev)** | MIT | Reuse — the `gasless.ts` seam is documented but stubbed; adopt rather than build. |
| Embedded wallet | **Privy** (SDK) or **Web3Auth** (OSS core) | mixed | Evaluate; the ROADMAP already assumes "reuse the Aether wallet infra." |
| Vector search for GraphRAG / fusion blocking | **pgvector** (already on Postgres) | PostgreSQL (permissive) | Reuse — no new infra; blocking + retrieval on the DB you already run. |
| Relay queue / durability | **BullMQ** (Redis) | MIT | Build-on if relay throughput grows past SQLite. |
| Observability | **OpenTelemetry + Grafana** (`oracle/backend/supabase-grafana-agent` exists) | Apache-2.0 | Reuse. |

**Net:** Predikt's OSS foundation is already strong and correctly licensed. The additions are all
MIT/Apache/permissive; the one thing to *protect* is the LGPL boundary around FPMM.

---

## 5. OSS-vs-commercial verdict

### Verdict: **Open-core** (GitLab framing), with a **hosted-service + ops** paid tier.

**Why not fully open-source (Chrome/Linux framing):** the core app is *already* effectively open —
Predikt is a fork of MIT Manifold and the contracts are MIT Polymarket. There is little moat in the app
code itself; anyone can fork Manifold. Pure-OSS gives away the one differentiated asset (the dual-mode
on-chain layer) with no capture.

**Why not fully private (Cursor framing):** Cursor works closed because its value is a proprietary
model + UX with no open substitute. Predikt's substrate is public OSS; a closed fork earns no trust in a
*trustless-settlement* product (the whole pitch is "verify it yourself, no admin can flip results") and
loses the community-distribution advantage that Manifold-style products live on. Closed contradicts the
value proposition.

**Open-core (GitLab) is the fit.** Ship the substrate open, keep the *operational and growth* layer as
the paid product:

| Open (public repo, MIT-compatible) | Commercial / private (the paid tier) |
|---|---|
| The web app fork (`oracle/web`), contracts (`predikt-contracts`), `@predikt/orders`, the demo, docs | **Hosted Predikt** — you run the relay + market-maker + scheduler + RPC + monitoring; customers get a live market venue without operating a CLOB. |
| `packages/onchain-sdk`, `packages/compliance` (jurisdiction) | **AI market factory API** (metered) — the news→markets engine (`lib/ai` + `graph/` GraphRAG) as a paid endpoint. This is the clearest standalone SaaS. |
| Self-host guide (`LAUNCH-RUNBOOK.md`, `DEPLOY.md`) | **Managed relay / market-maker-as-a-service** — the operationally hard part (`predikt-relay`, `marketmaker/`, risk limits, key custody). |
| The bots (herald/relay-tg/twitch) | **Enterprise**: jurisdiction/compliance config + audited-fork deployment + white-label embeds + priority support + fee-revenue share. |

The paid tier is **operations + AI + compliance**, not code — exactly GitLab's model (open core, paid
CI-runners/security/support). It also aligns with the trust story: the settlement code is auditable and
open; you charge for *running it well*.

**Practical monetization primitives already in the tree:** the exchange has a `Fees` mixin (protocol fee
on on-chain trades) and the ROADMAP bakes in **creator fee cuts** — so a **take-rate on on-chain volume**
and a **factory/API subscription** are the two native revenue lines.

---

## 6. Growth angle (solo founder, ~zero marketing, one Twitter @caelum0x42)

### 6.1 Honest demand reality

Be blunt: **prediction markets are a brutal cold-start.** Two hard truths:

1. **Liquidity is the product.** An empty market venue has zero value; the first user has nobody to
   trade against. Polymarket spent years + heavy incentives to get liquid; below its top ~50 markets it
   is still thin. A solo founder cannot out-liquidity anyone.
2. **The general public does not wake up wanting to bet on a CLOB.** Real organic demand concentrates in
   a few tribes: **crypto-native traders**, **sports bettors**, and small **forecasting/EA/rationalist**
   communities (the `prediction/` sibling tree — compass, endow, forge, converge — shows this is exactly
   the network the founder sits near).

So do **not** launch "a Polymarket competitor" to a cold audience. That fails. Instead, use the assets
that *don't* need liquidity to be valuable.

### 6.2 The realistic wedge: distribution-first, liquidity-light

The winning solo path is to **lead with the play-money + embed + bot layer** (viral, no liquidity
needed, no regulatory exposure) and treat on-chain USDC as an upsell for the few markets that get
traction.

**Channel (pick ONE, go deep):** **embeddable play-money markets inside existing communities.**

- The bots already exist: **herald (Discord), relay-tg (Telegram), twitch-bot**. Communities *already*
  argue about outcomes (a crypto Discord on "will ETH hit $5k," a sports server, a creator's Twitch
  chat). Drop a Predikt market into that channel where the audience already is — **markets go to the
  users, not users to markets.** Zero paid marketing; the community is the distribution.
- **Embeddable widgets** on blogs/newsletters (the substrate has OG images + embeds) — a forecaster's
  Substack embeds a live market; every reader is a funnel entry.
- **@caelum0x42** posts one thing that actually spreads on CT: *the trustless-settlement demo*
  (`demo/` one-command anvil → real UMA-resolved market) and the **AI market factory** (turn today's
  headline into a market in 5 seconds). Build-in-public + a genuinely novel demo is the only free
  acquisition a solo dev gets; the AI-market-from-news clip is the shareable artifact.

### 6.3 Monetization + time-to-first-revenue (honest)

**The market venue itself will not pay the bills for a long time.** Fastest realistic revenue is the
*tooling*, not the trading:

| Path | Revenue | Time-to-first-$ (honest) |
|---|---|---|
| **AI market-factory API / SaaS** — "news → structured market drafts + resolution suggestions," sold to other market platforms, media, Discord communities | subscription / metered | **Fastest — weeks-to-1-2 months.** It's a self-contained API (`lib/ai` + Zod), needs no liquidity, no chain, no users. This is the most fundable standalone product in the repo. |
| **Managed relay / market-venue-as-a-service** — run the CLOB + MM for a community/DAO that wants its own market | setup + monthly | 2–4 months (needs one design-partner community). |
| **On-chain protocol fee** (`Fees` mixin) + **creator-fee take-rate** | % of volume | **Slow — 6–12+ months**, gated on real liquidity. Don't count on this early. |
| **Premium play-money features** (leagues, boosts — Manifold already monetizes this) | microtransactions | Medium, only after a community adopts it. |

**Recommended sequence for a solo founder:**

1. **Weeks 1–4:** ship the **AI market factory as a standalone API + a Discord/Telegram bot** into 1–2
   communities the founder is already in. Post the news→market demo from @caelum0x42. Goal: *usage*, not
   revenue.
2. **Month 2–3:** if a community engages, turn on **play-money markets + embeds** there; charge for the
   **factory API / a "host your own market" managed offering** to the first design partner. First revenue
   here.
3. **Month 4+:** only for a market that organically got liquid, enable **on-chain USDC** (jurisdiction-
   gated) and the protocol fee. Real trading revenue is a *later* consequence of distribution, never the
   opening move.

**Bottom line:** the code is launch-ready; the constraint is demand. Win by giving the liquidity-free
assets (AI factory, embeds, bots, play money) to communities that already exist, monetize the *tooling*
first, and let on-chain trading revenue accrue slowly on the few markets that catch — rather than betting
the company on beating Polymarket at liquidity from a standing start.

---

## 7. Scale reality

### 7.1 Current size (measured)

| Module | Files | LOC | Note |
|---|---:|---:|---|
| `oracle/web` | 924 | ~180,500 | Manifold app + Predikt onchain/ai/compliance delta |
| `oracle/backend` | 945 | ~94,000 | Supabase + cloud functions + scheduler |
| `oracle/common` | 539 | ~76,000 | shared domain/CPMM |
| `oracle/twitch-bot` | 54 | ~5,900 | |
| `predikt-contracts` (Solidity src) | ~60 | ~7,400 | + `@predikt/orders` ~2,000 TS |
| `predikt-relay` | 22 | ~3,100 | CLOB operator |
| `oracle/native` + `mani` | ~50 | ~2,000+ | Expo shells |
| `herald` / `relay-tg` / `liquify` / `autopilot` | ~25 | ~2,600 | bots |
| **Predikt-specific delta** (onchain+ai+compliance+parlay+relay+contracts) | — | **~20,000** | the real net-new engineering |
| **Total workspace** | ~2,600 | **~375,000** | majority inherited OSS |

The honest read: **~375K LOC, but only ~20K is Predikt's own moat.** That is *good* — leverage over OSS
is the point — but it means the enterprise plan is mostly about **extracting, hardening, and
operationalizing that 20K** (§2 `packages/`, §3 graph, §4 additions), not writing hundreds of thousands
of new lines.

### 7.2 Target per-module scale (enterprise)

| Area | Target files | Target LOC | Delta work |
|---|---:|---:|---|
| `packages/onchain-sdk` (extract) | ~40 | ~10K | refactor from web/lib/onchain, harden |
| `packages/ai-factory` + `graph/` | ~60 | ~12K | **new** — ontology, extractors, fusion, GraphRAG, LangGraph DAGs |
| `services/resolver` | ~25 | ~5K | **new** — dispute-window orchestration (§3.4 Flow B) |
| `services/indexer` (Ponder) | ~20 | ~3K | replace hand-rolled polling |
| `services/relay` + risk/observability | +30 | +6K | position limits, circuit breakers, metrics |
| `apps/admin` | ~40 | ~8K | extract resolution/moderation ops |
| `infra/` | ~30 | ~4K | Terraform/Docker/runbooks |
| Test coverage to 80% on the delta | — | +8K | per testing rules |
| **New/refactor engineering** | ~265 | **~55–65K** | on top of the inherited base |

### 7.3 Done-ladder

1. **L0 — Prove locally (done).** `forge test` green, relay e2e 21/21, AMM 18/18, one-command demo 20/20.
2. **L1 — First deploy.** Backend on Supabase/Firebase; web on Vercel; play-money bet round-trips. *(Gate: sign-in + off-chain bet resolves.)*
3. **L2 — Testnet on-chain.** Deploy contracts to Amoy; relay + MM live; router-chosen fill + UMA resolve + USDC redeem. *(Gate in LAUNCH-RUNBOOK Phase 2.)*
4. **L3 — Extract packages + graph.** `packages/onchain-sdk`, `packages/ai-factory`, `graph/ontology.yaml` + fusion; dedupe markets into `Event`s.
5. **L4 — Resolver + indexer services.** Dispute-window orchestration; Ponder indexer feeds the graph; 80% test coverage on the delta.
6. **L5 — Mainnet + fork audit.** Audited contracts on Polygon; small real-USDC round-trip; relay hardened (HTTPS, rate limits, CORS, DB backups).
7. **L6 — Commercial tier.** AI-factory API metered; managed-relay offering; protocol fee + creator take-rate live.
8. **L7 — Distribution flywheel.** Embeds + bots seeded in real communities; @caelum0x42 build-in-public; first paying design partner.

---

## Appendix — Older `prediction/` tree (context)

The sibling `/Users/arhansubasi/products/prediction` is an **earlier split source tree of the same
product family** — the modules were later consolidated/renamed into today's `predikt/`. It shows the
founder's surrounding ecosystem and confirms the target audience:

- **oracle** / **oracle-mcp** — the market app + an **MCP server** exposing market create/trade/liquidity
  tools to agents (a reusable idea: ship an MCP interface to the factory).
- **herald** / **autopilot** / **liquify** — the same Discord bot / trader / MM (now in `predikt/`).
- **agora** — a forum (LessWrong/EA Forum engine); **compass** — AI-safety donation DB; **endow** —
  grants/crowdfunding; **gather** — events; **nexus** — coworking; **converge**/**forge** — Manifest/
  Manifund incubator sites; **spark**, **trifecta**, **assessor** — smaller experiments.

The signal: the founder is embedded in the **forecasting / EA / rationalist / Manifold** network. That is
the warm, liquidity-tolerant first audience §6 recommends — not the cold general public.
