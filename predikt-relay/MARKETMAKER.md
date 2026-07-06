# Predikt On-Chain Market Maker

A standalone entrypoint inside the relay package that seeds **two-sided
liquidity** into the relay's order book. Without resting orders the on-chain
book is empty and single-side market orders (e.g. "buy YES at 63¢") have nothing
to match against. The market maker posts **real, EIP-712-signed** limit orders to
the relay's `POST /orders` endpoint so those market orders can fill.

It mirrors the pricing idea of the off-chain reference maker (`liquify`) — a
ladder of limit orders around a fair mid — but every order is a real signed
on-chain order settled through the Predikt `CTFExchange`, not a play-money bet.

## What it does

On each refresh cycle, for every configured market outcome (both the YES and NO
token of each pair):

1. **Price** — determine a fair mid:
   - the mid of the best bid/ask in the relay book (`GET /book`) if present;
   - else the oracle market's probability (`ORACLE_API_URL`, the same backend
     `liquify` reads) — complemented (`1 - p`) for the NO token;
   - else `0.5`.
2. **Build ladder** — a symmetric BUY/SELL ladder `MM_LEVELS` deep, stepping
   `MM_SPREAD_BPS` (bps of the 0..1 probability) per level around mid, each order
   sized `MM_ORDER_SIZE` USDC of notional. Prices are clamped to a `[0.01, 0.99]`
   band so orders never sit on the rails.
3. **Fund-check** (real viem reads, per side, for the whole ladder):
   - BUY side needs USDC **balance + allowance** ≥ the total the ladder spends.
   - SELL side needs an outcome-token **balance + exchange approval** ≥ the total
     shares the ladder sells.
   - An under-funded side is **skipped with a clear warning** — never faked.
   - If `MM_MINT_SETS=true` and the SELL side is short on tokens, the maker mints
     the shortfall via a real `ConditionalTokens.splitPosition` (locks USDC into a
     full YES/NO set) before quoting.
4. **Sign** — each level is signed with the maker account through
   `@predikt/orders` (`ExchangeOrderBuilder`): the correct EIP-712 domain
   (`Polymarket CTF Exchange` / `1`), a CSPRNG salt (`generateOrderSalt`), the
   EOA `signatureType`, and the maker's ECDSA signature.
5. **POST** — submit each signed order to the relay's `POST /orders`.

Then it loops every `MM_REFRESH_MS`: **cancel** the maker's stale orders (sign a
relay `Cancel(orderHash,deadline)` via `@predikt/orders.signCancel`, call
`DELETE /orders/:hash`) and **re-post** the fresh ladder. On `SIGINT`/`SIGTERM`
it cancels all open orders before exiting.

### Exact flow

```
start:   load config → derive maker EOA → resolve MM_MARKETS to YES/NO pairs
         (on-chain getComplement + getConditionId) → ensure USDC approve +
         CTF setApprovalForAll → run first refresh → setInterval(refresh)

refresh: for each token:
           price  → mid from relay GET /book, else oracle prob, else 0.5
           build  → BUY/SELL ladder MM_LEVELS deep at MM_SPREAD_BPS steps
           fund   → viem reads: USDC bal+allowance (BUY), CTF bal+approval (SELL)
                    (skip under-funded side; optional splitPosition mint for SELL)
           sign   → @predikt/orders ExchangeOrderBuilder (EIP-712, EOA, CSPRNG salt)
           POST   → relay POST /orders
         cancel-then-repost each cycle:
           cancel → signCancel → DELETE /orders/:hash for each live hash
           repost → the fresh ladder above

stop:    clearInterval → cancel all live orders → exit
```

## Environment variables

Set these in the relay's `.env` (see `.env.example`). The maker **reuses** the
relay's chain/exchange env (`CHAIN_ID`, `RPC_URL`, `EXCHANGE_ADDRESS`,
`USDC_ADDRESS`, `CTF_ADDRESS`) so one `.env` drives both.

| Var | Default | Meaning |
|-----|---------|---------|
| `MM_PRIVATE_KEY` | — (required) | Maker EOA key: source of funds + signer of every order. **Distinct from `OPERATOR_PK`.** Never logged/committed. |
| `RELAY_URL` | `http://localhost:8787` | Relay REST base URL (`POST`/`DELETE /orders`, `GET /book`). |
| `MM_MARKETS` | — (required) | Comma-separated outcome **token ids** (uint256 decimal) and/or **oracle market ids** (discovered via `ORACLE_API_URL`). Each resolves to its YES+NO pair. |
| `MM_SPREAD_BPS` | `100` | Half-spread per level, in bps of the 0..1 probability. |
| `MM_ORDER_SIZE` | `10` | Notional size per order, in whole USDC. |
| `MM_LEVELS` | `3` | Depth: price levels quoted per side (max 20). |
| `MM_REFRESH_MS` | `30000` | Refresh cadence: cancel + re-post the ladder. |
| `MM_MINT_SETS` | `false` | If true, mint outcome-token sets via `splitPosition` (spends USDC) to fund the SELL side. |
| `ORACLE_API_URL` | — | Optional oracle backend base URL for the mid fallback + token-id discovery. |

## How to fund the maker wallet

The maker EOA (`MM_PRIVATE_KEY`) is a **normal user account**, not the relay
operator. Fund it once:

1. **USDC (for BUY orders)** — send USDC to the maker address. The maker
   auto-approves the exchange to pull USDC on startup (idempotent max approval).
2. **Outcome tokens (for SELL orders)** — the maker needs the ERC1155 outcome
   tokens it wants to sell. Two options:
   - **Automatic mint (simplest, on by default when `MM_MINT_SETS=true`)** — the
     maker calls `ConditionalTokens.splitPosition`, locking USDC to mint an equal
     full set of **both** YES and NO tokens (redeemable back to that USDC). It
     mints only the shortfall each cycle. This spends real USDC into conditional
     tokens, so it is opt-in.
   - **Pre-mint yourself** — split positions / acquire the outcome tokens in
     advance and leave `MM_MINT_SETS=false`. If the SELL side is under-funded it
     is skipped (with a warning) and only the BUY side is quoted.
   - The maker auto-approves the exchange as an ERC1155 operator on startup.

The maker's EOA must have a little native gas token for the approve/mint txs.

## How to run

From `predikt-relay/`:

```bash
# 1. Configure .env (copy from .env.example, fill MM_PRIVATE_KEY, MM_MARKETS, …)
cp .env.example .env

# 2. Make sure the relay is running (npm start) and reachable at RELAY_URL.

# 3. Run the market maker (TypeScript, via Node type-stripping):
npm run mm

# …or run the compiled build:
npm run build
npm run mm:build
```

## Safety notes

- **Dedicated, funded account.** Use a wallet reserved for market making, funded
  only with what you're willing to expose. It is a `msg.sender` for on-chain
  approvals/mints and the maker of every posted order.
- **Bounded exposure.** Total resting exposure per token is roughly
  `MM_LEVELS × MM_ORDER_SIZE` per side. Size these to your risk budget.
- **No secrets committed.** `MM_PRIVATE_KEY` lives only in `.env` (git-ignored)
  and is redacted from all structured logs — it is never printed.
- **No fakes.** Every order is a real EIP-712 signature; every fund check is a
  real on-chain read; minting is a real `splitPosition`. Under-funded sides are
  skipped, never spoofed.
- **Cancel on exit.** `SIGINT`/`SIGTERM` cancels all open orders before exit, so
  no stale liquidity is left resting when the maker stops.
