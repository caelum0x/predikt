# Predikt — one-command local full-stack demo

Boots the **entire Predikt on-chain stack** on a single local anvil chain, seeds
**both trading venues** (the FPMM AMM and the relay CLOB), starts the relay HTTP
server, runs a **router self-check** that proves a real on-chain trade end-to-end,
prints the env block to point the web app at this stack, and then **stays up for
manual poking** until you press Ctrl-C (clean teardown on exit).

Everything is **REAL** — real `anvil`, real contract deploys, real EIP-712 signed
orders, real `matchOrders` / AMM `buy` settlement, real on-chain balance
assertions. Nothing is mocked or faked beyond the repos' own USDC /
ConditionalTokens / UMA test stubs. It **reuses the existing e2e harnesses and
deploy artifacts** — no contracts or AMM are re-implemented.

## Run it

```bash
cd demo
npm run demo            # boots the full stack, then stays up until Ctrl-C
```

`npm run demo` first runs `setup-deps.mjs` (via the `predemo` hook), which
symlinks `viem` + `@predikt/orders` from `../predikt-relay/node_modules` — so as
long as the relay has been installed (`cd ../predikt-relay && npm install`), no
extra install is needed. `anvil` / `forge` / `cast` must be on your PATH.

CI / timeboxed mode (boot → self-check → tear down → exit, no hang):

```bash
npm run demo:selfcheck  # DEMO_SELFCHECK_ONLY=1
```

Ports are overridable: `DEMO_RPC_PORT` (default 8545), `DEMO_RELAY_PORT`
(default 8787).

## What it boots

On one anvil (chainId 31337, anvil default mnemonic), deployed **once**:

| Contract | Source repo | Role |
|---|---|---|
| USDC mock (6dp) | `ctf-exchange` | collateral |
| ConditionalTokens | `ctf-exchange` | outcome-token framework |
| CTFExchange | `ctf-exchange` | CLOB on-chain settlement |
| FPMMDeterministicFactory | `fpmm` | instant-liquidity AMM |
| Finder / Store / IdentifierWhitelist / AddressWhitelist / OptimisticOracleV2 | `uma-ctf-adapter` (precompiled) | UMA optimistic-oracle stack |
| OracleStub (DVM) | `uma-ctf-adapter` | UMA dispute-resolution stub |
| UmaCtfAdapter | `uma-ctf-adapter` | UMA-backed CTF resolution |

Then it:

1. **Wires + exercises UMA**: whitelists USDC + the `YES_OR_NO_QUERY` identifier,
   points the Finder at each UMA component, deploys the adapter, and
   `initialize`s a **real UMA-backed condition** (this calls
   `ctf.prepareCondition(adapter, …)` and requests a price from the OO).
2. **Prepares a tradeable condition** (deployer = oracle so you can
   `reportPayouts` while poking), `registerToken(YES, NO)` on the exchange, and
   **grants the relay operator the exchange operator role**.
3. **Seeds the AMM**: `create2FixedProductMarketMaker` + `addFunding` → an FPMM
   pool with 1,000 USDC of 50/50 YES/NO liquidity at a 2% fee.
4. **Starts the relay** (`predikt-relay/dist/server.js`) against anvil and
   **seeds the CLOB** with two real signed maker SELL orders (100 YES @ 0.55 and
   @ 0.60).
5. **Router self-check**: quotes the AMM (`calcBuyAmount`) vs the CLOB best ask
   (`GET /book`), **executes the cheaper venue** (AMM `buy` or a marketable CLOB
   BUY the relay matches via `matchOrders`), and **asserts the on-chain fill**.
6. **Stays up** until Ctrl-C, then kills anvil + relay and cleans the temp DB.

## Env to paste into the web app

The demo prints the live block below (addresses are deterministic on the anvil
default mnemonic, so they'll match on a clean run). Paste into
`oracle/web/.env.local` to point the web app at this local stack:

```dotenv
# Predikt local full-stack demo — anvil chainId 31337
NEXT_PUBLIC_ONCHAIN_CHAIN_ID=31337
NEXT_PUBLIC_ONCHAIN_RPC_URL=http://127.0.0.1:8545
NEXT_PUBLIC_ONCHAIN_USDC_ADDRESS=0x5fbdb2315678afecb367f032d93f642f64180aa3
NEXT_PUBLIC_ONCHAIN_CTF_ADDRESS=0xe7f1725e7734ce288f8367e1bb143e90bb3f0512
NEXT_PUBLIC_ONCHAIN_EXCHANGE_ADDRESS=0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0
NEXT_PUBLIC_ONCHAIN_FPMM_FACTORY_ADDRESS=0xcf7ed3acca5a467e9e704c703e8d87f634fb0fc9
NEXT_PUBLIC_ONCHAIN_UMA_ADAPTER_ADDRESS=0x68b1d87f95878fe05b998f19b66f4baba5de1aed
NEXT_PUBLIC_ONCHAIN_CONDITION_ID=0xa31e4fca75db73314836adfc0e5c5e65603a188c04df9b82054fa6d0a3eadb7a
NEXT_PUBLIC_ONCHAIN_YES_TOKEN_ID=106309399066611104344339450568845001613773167337438580070147782153941340113901
NEXT_PUBLIC_ONCHAIN_NO_TOKEN_ID=27599669721907256405431727915019436831126340560536092936582278123512558798562
NEXT_PUBLIC_ONCHAIN_FPMM_POOL_ADDRESS=0x58b674460E5167528939511F6e4047469593871c
NEXT_PUBLIC_RELAY_URL=http://127.0.0.1:8787
RELAY_URL=http://127.0.0.1:8787
```

> The condition/token ids depend on the deployed contract addresses; the
> addresses above are what anvil's default mnemonic + this deploy order produce.
> Always copy the block the running demo prints — it is the source of truth.

## Poke it while it's up

```bash
curl http://127.0.0.1:8787/health
curl "http://127.0.0.1:8787/book?tokenId=<YES_TOKEN_ID>"
# quote the AMM directly (100 USDC → YES, outcome index 0):
cast call <FPMM_POOL> "calcBuyAmount(uint256,uint256)" 100000000 0 --rpc-url http://127.0.0.1:8545
```

No secrets are committed. The relay's operator key is an anvil default test key
(publicly known, local-only); the temp SQLite DB lives under the OS temp dir and
is deleted on teardown.

## Reused from the existing harnesses

- `predikt-relay/test/e2e/run.mjs` — anvil boot, contract deploy, funding,
  `registerToken` / `addOperator`, relay boot, signed-order flow.
- `predikt-contracts/fpmm/test-e2e/run.mjs` — FPMM factory deploy + create/seed +
  buy/sell.
- `predikt-relay/dist/server.js` — the real relay HTTP server, unchanged.
- `@predikt/orders` `ExchangeOrderBuilder` — real EIP-712 order signing.
- All contract bytecode from the repos' own `out/` and `artifacts/` builds.
