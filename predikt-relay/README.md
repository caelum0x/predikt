# Predikt CLOB Relay Operator

The off-chain half of Predikt's central-limit order book. It is a real
Node/TypeScript service that:

1. Accepts **real, signed EIP-712 orders** over HTTP.
2. Validates them against the deployed **Predikt `CTFExchange`** (signature, hash,
   token registration, nonce, and the maker's USDC / CTF balance + allowance).
3. Keeps a **price-time-priority order book** persisted in SQLite.
4. When an incoming order is marketable, acts as the exchange **operator** and
   submits the **real on-chain settlement tx** (`matchOrders`).
5. Derives order status **only from on-chain `OrderFilled` / `OrdersMatched` /
   `OrderCancelled` events** — never from an optimistic/faked fill.

Polymarket runs this matching layer privately; here it is Predikt's own code,
settling against our `CTFExchange`.

## Relation to the rest of Predikt

| Component | Role | Location |
|-----------|------|----------|
| `CTFExchange` | On-chain non-custodial trading + settlement. `fillOrder` / `matchOrders` are operator-gated. | `../predikt-contracts/ctf-exchange` |
| `@predikt/orders` | Order shape + EIP-712 domain/struct definitions. The relay imports order **types** from this SDK and re-declares the two load-bearing enums (`OrderSide`, `SignatureType`) in `src/orders.ts` so the runtime has no dependency on the SDK's viem-based builder. | `../predikt-contracts/clob-client` |
| `UmaCtfAdapter` | Trustless UMA market resolution (settlement of the underlying condition). | `../predikt-contracts/uma-ctf-adapter` |
| **This relay** | Off-chain book + on-chain matcher/operator. | here |

The EIP-712 domain the relay hashes/verifies against is
`("Polymarket CTF Exchange", "1", chainId, exchangeAddress)` — the exact,
load-bearing constant baked into the deployed contract (`Hashing(...)`), so
relay hashes are byte-identical to the on-chain `hashOrder`.

## Architecture

```
            POST /orders (signed EIP-712 order)
                       │
                       ▼
   ┌──────────────────────────────────────────────┐
   │ API (express)  src/api                        │  zod validation, rate limit
   └──────────────────────────────────────────────┘
                       │
                       ▼
   ┌──────────────────────────────────────────────┐
   │ RelayEngine  src/engine.ts                    │
   │  validate → persist → book.add → tryMatch     │
   └──────────────────────────────────────────────┘
        │                    │                 │
        ▼                    ▼                 ▼
  ExchangeClient        OrderBook          RelayStore
  src/chain/exchange    src/book/book      src/store/db (SQLite)
  (viem read/write)     (price-time)       (durable orders+trades)
        │                                        ▲
        │ matchOrders (as OPERATOR)              │
        ▼                                        │
   ┌──────────────┐   OrderFilled / OrdersMatched / OrderCancelled
   │ CTFExchange  │ ─────────────────────────────►  EventIndexer
   └──────────────┘                                 src/chain/indexer.ts
                                     (authoritative status + trades)
```

## Endpoints

All responses use the envelope `{ success, data?, error? }`.

| Method & path | Purpose |
|---------------|---------|
| `GET /health` | Operator address, exchange, chainId, current block. `503` if RPC is down. |
| `POST /orders` | Accept a signed EIP-712 order (see validation below). Returns the order hash, resulting status, and — if it matched — the settlement `txHash` and per-maker fills. |
| `DELETE /orders/:hash` | Maker-authenticated off-chain cancel. Body: `{ "maker": "0x…" }`; must equal the order's maker. |
| `GET /book?tokenId=` | Resting book for a token: `bids` (BUY, best price first) and `asks` (SELL). |
| `GET /orders?maker=` | All orders (any status) for a maker. |
| `GET /trades?tokenId=` | Settled fills for a token, newest first (sourced from on-chain events). |

### `POST /orders` validation (in order)

1. **Signature type** — only `EOA` (0) is accepted; proxy/safe/1271 are rejected.
2. **Amounts / expiration** — `makerAmount` and `takerAmount` must be > 0; a
   non-zero `expiration` must be in the future.
3. **Idempotency** — if the order hash is already known, its current state is
   returned without re-processing.
4. **EIP-712 signature** — verified against the exchange domain with the maker
   as the recovered signer (`signer == maker`).
5. **Token registered** — `getComplement(tokenId)` must succeed and be non-zero.
6. **Nonce** — `isValidNonce(maker, nonce)` must be true on-chain.
7. **Maker funding** — BUY: maker USDC `balanceOf` + `allowance(maker, exchange)`
   cover `makerAmount`. SELL: maker CTF `balanceOf(maker, tokenId)` covers
   `makerAmount` and `isApprovedForAll(maker, exchange)` is true.
8. **Not already settled** — the exchange `getOrderStatus(hash)` must not be
   filled/cancelled.

## Matching & the exact on-chain calls

Fills are sized **in maker-amount units**, exactly as the exchange expects. The
matcher walks the best-priced resting **opposite-side** orders (COMPLEMENTARY:
BUY↔SELL on the same tokenId), consuming shares until the taker is exhausted or
the book stops crossing (`CalculatorHelper.isCrossing` semantics, reproduced in
`src/book/order.ts` / `matcher.ts`). Then the engine submits, as the operator
wallet, exactly one call:

- **Crossed book (taker vs one-or-more makers) →**
  `matchOrders(takerOrder, makerOrders[], takerFillAmount, makerFillAmounts[])`
  `takerFillAmount` is in the taker's maker-amount units; each
  `makerFillAmounts[i]` is in that maker's maker-amount units. The exchange
  mints/merges/transfers to reconcile (`_matchOrders`). The **single-maker case
  uses the same call with a 1-element `makerOrders` array** — the canonical,
  tested pattern (`ctf-exchange` `MatchOrders.t.sol`).

  The relay deliberately does **not** use `fillOrder` for matching. In
  `fillOrder` the operator is the counterparty (`to = msg.sender`), so the
  operator would have to supply/receive the taker-side assets — an
  operator-liquidity primitive, not order-book matching. In `matchOrders` the
  taker order is the active order and self-funds against the Exchange; the
  operator only pulls the fee. `ExchangeClient.fillOrder` remains available for
  operators that also want to provide direct liquidity, but it is off the
  matching path.

The call is **simulated first** (`simulateContract`) so a revert surfaces
before broadcast and no gas is wasted. After broadcast the engine waits for the
receipt and triggers an indexer sync; **order `remaining` and status are then
read back from `getOrderStatus` and driven by the emitted events** — the relay
never marks a fill it did not observe on-chain.

Conversion helpers (contract-faithful):
`taking = making * takerAmount / makerAmount` (floor) and the price/crossing
formulas mirror `CalculatorHelper` byte-for-byte.

## Operator role

The wallet derived from `OPERATOR_PK` is `msg.sender` for every `fillOrder` /
`matchOrders`. Those functions are `onlyOperator`, so **the exchange deployer
must grant this address the operator role**:

```solidity
CTFExchange(exchange).addOperator(<relay operator address>);
```

`GET /health` prints the operator address to register. The operator collects
fees implicitly (fees are deducted from the assets it pays), per `Trading.sol`.

## Environment

Copy `.env.example` → `.env` and fill in. **Never commit `.env`.** The operator
private key is never logged (pino redaction). Required:

| Var | Meaning |
|-----|---------|
| `PORT` | HTTP port (default 8787). |
| `SUBMIT_RATE_LIMIT_PER_MIN` | Per-IP limit on `POST`/`DELETE /orders`. |
| `CHAIN_ID`, `RPC_URL` | Chain + JSON-RPC endpoint. |
| `EXCHANGE_ADDRESS` | Deployed `CTFExchange`. |
| `USDC_ADDRESS`, `CTF_ADDRESS` | Must equal the exchange's `collateral` and `ctf`. |
| `OPERATOR_PK` | Operator EOA private key (secret). Must hold the operator role. |
| `DATABASE_PATH` | SQLite file (created if missing). |
| `START_BLOCK` | Optional block to begin event scanning from. |

## Run

```bash
npm install
cp .env.example .env      # then fill in real values
npm run typecheck         # tsc --noEmit
npm run build             # compile to dist/
npm start                 # node dist/server.js
# or, for local dev with live reload + native TS:
npm run dev
```

## Market maker

The relay ships with an on-chain **market maker** entrypoint that seeds
two-sided liquidity into the book so single-side market orders have resting
orders to match against. It builds a ladder of BUY/SELL limit orders around a
fair mid, signs each with a maker EOA via `@predikt/orders` (real EIP-712), and
submits them to `POST /orders`, re-quoting every cycle.

```bash
npm run mm                # native TS via node type-stripping
# or: npm run build && npm run mm:build
```

See [MARKETMAKER.md](./MARKETMAKER.md) for env vars (`MM_PRIVATE_KEY`,
`MM_MARKETS`, `MM_SPREAD_BPS`, `MM_ORDER_SIZE`, `MM_LEVELS`, `MM_REFRESH_MS`,
`MM_MINT_SETS`), how to fund the maker wallet (USDC + minting sets), and safety
notes.

## Safety

- Rejects invalid-signature and insufficient-balance/allowance orders.
- Idempotent on order hash (submit) and on `(txHash, logIndex)` (trades).
- Per-IP rate limiting on write endpoints.
- Structured logging (pino) with private-key/secret redaction.
- All inbound payloads are zod-validated (uint256 fields parsed as BigInt);
  amounts are stored as decimal strings, never interpolated into SQL — all DB
  access is via parameterized `better-sqlite3` statements.

## Persistence

`better-sqlite3` (WAL mode). `orders` and `trades` tables plus a `meta` cursor
for the event indexer. On boot the book is **rehydrated** from all
OPEN/PARTIALLY_FILLED orders, so a restart never loses resting liquidity.
