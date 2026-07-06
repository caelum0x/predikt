# Deploy — real Polymarket contracts (on-chain / crypto markets)

The app calls the **real** Polymarket + Gnosis + UMA contracts directly. **No
Solidity is written, wrapped, vendored, or reimplemented here.** You deploy the
two Polymarket contracts with **each repo's OWN forge script**; the primitives
(Gnosis ConditionalTokens, USDC, UMA OptimisticOracleV2 + Finder) are **already
live** on Polygon — you call them at their real addresses.

Two things happen:

1. Deploy `UmaCtfAdapter` and `CTFExchange` using the repos' own scripts.
2. Copy the resulting addresses (+ the primitives' real addresses) into the web
   app's `NEXT_PUBLIC_*` env so the viem client in `oracle/web/lib/onchain`
   targets them.

Prereqs: [Foundry](https://getfoundry.sh) (`forge`, `cast`) and `jq` (the
repos' deploy shell scripts pipe `forge --json` through `jq`).

---

## Automated deploy (recommended) — `deploy-kit/`

You can run the two forge scripts, the FPMM factory deploy, and the operator
grant as **one guided, ordered flow** with [`deploy-kit/`](./deploy-kit). It
**wraps the repos' OWN deploy scripts** (writes no new Solidity), runs them in the
correct order with the correct real primitive addresses, grants the relay operator
the exchange operator role, writes `addresses.<chain>.json`, and prints the exact
env blocks to paste into `oracle/web`, the relay, and the market maker.

```bash
cd deploy-kit
node setup-deps.mjs                          # one-time: link viem from ../../predikt-relay
node deploy.mjs --chain amoy --dry-run        # rehearse end-to-end (broadcast nothing)

# real testnet go-live (needs a funded key + gas):
PRIVATE_KEY=0x… RELAY_OPERATOR=0x… RPC=https://rpc-amoy.polygon.technology \
  node deploy.mjs --chain amoy
# then, once verified, Polygon mainnet:
PRIVATE_KEY=0x… RELAY_OPERATOR=0x… RPC=https://your-polygon-rpc \
  node deploy.mjs --chain polygon
```

Ordered steps: **(1)** CTFExchange (its `ExchangeDeployment` script, collateral =
native USDC) → **(2)** UmaCtfAdapter (its `DeployAdapter` script, real CTF + UMA
Finder/OO) → **(3)** FPMM factory (the `deploy-fpmm.mjs` pattern) → **(4)**
`CTFExchange.addOperator(<relay operator>)`. It is **idempotent-aware**, **testnet
first**, and **writes no secrets** (keys stay in the env; `addresses.<chain>.json`
holds only PUBLIC addresses). See [`deploy-kit/README.md`](./deploy-kit/README.md)
for the auth model (the deployer must stay exchange admin to run step 4) and full
safety notes.

The manual per-repo instructions below still apply — the kit just runs them in
order for you.

---

## Real primitive addresses (already deployed — do NOT redeploy)

Use these as the constructor inputs to the two scripts and in the app env.
Sources cited per row.

### Polygon mainnet — chain `137`

| Primitive | Address | Source |
| --- | --- | --- |
| Gnosis ConditionalTokens (`CTF`) | `0x4D97DCd97eC945f40cF65F87097ACe5EA0476045` | [PolygonScan (verified "Polymarket: Conditional Tokens")](https://polygonscan.com/address/0x4d97dcd97ec945f40cf65f87097ace5ea0476045) |
| UMA `OptimisticOracleV2` | `0xeE3Afe347D5C74317041E2618C49534dAf887c24` | [UMA networks/137.json](https://github.com/UMAprotocol/protocol/blob/master/packages/core/networks/137.json) |
| UMA `Finder` | `0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64` | [UMA networks/137.json](https://github.com/UMAprotocol/protocol/blob/master/packages/core/networks/137.json) |
| Polymarket Proxy Factory | `0xaB45c5A4B0c941a2F231C04C3f49182e1A254052` | [Polymarket docs — contract addresses](https://docs.polymarket.com/resources/contract-addresses) |
| Gnosis Safe Factory | `0xaacFeEa03eb1561C4e67d661e40682Bd20E3541b` | [Polymarket docs — contract addresses](https://docs.polymarket.com/resources/contract-addresses) |
| Collateral — **native Circle USDC** (app default — USE THIS) | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` | [Circle: USDC on PolygonScan](https://polygonscan.com/address/0x3c499c542cef5e3811e1192ce70d8cc03d5c3359) |
| Collateral — USDC.e (alternative — what real Polymarket markets settle in) | `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174` | [Polymarket example code](https://github.com/Polymarket/conditional-token-examples/blob/main/src/mint.ts) |

> **⚠️ Collateral MUST match the app.** The web app defaults to **native Circle
> USDC** (`0x3c49…3359`, `lib/onchain/chains.ts` → `NEXT_PUBLIC_ONCHAIN_USDC`).
> **Use the native USDC address above (the first row) as your `COLLATERAL`** so a
> deployer copying the first value matches the app out of the box. Real
> Polymarket markets settle in **USDC.e** (`0x2791…4174`); that is a valid
> *alternative* collateral, but if you pick it you **must** also set
> `NEXT_PUBLIC_ONCHAIN_USDC` to the same USDC.e address in the app. The token you
> pass as `COLLATERAL` when deploying the exchange **must equal**
> `NEXT_PUBLIC_ONCHAIN_USDC` (or the app default native USDC if you omit it) —
> a mismatch means users' funds cannot back the markets. Pick one and keep it
> consistent everywhere.

### Polygon Amoy testnet — chain `80002`

| Primitive | Address | Source |
| --- | --- | --- |
| ConditionalTokens (`CTF`) | `0x69308FB512518e39F9b16112fA8d994F4e2Bf8bB` | [polymarket-go-contracts AMOY config](https://pkg.go.dev/github.com/ivanzzeth/polymarket-go-contracts@v0.1.0) |
| Gnosis Safe Factory | `0xaacFeEa03eb1561C4e67d661e40682Bd20E3541b` | [polymarket-go-contracts AMOY config](https://pkg.go.dev/github.com/ivanzzeth/polymarket-go-contracts@v0.1.0) |
| Collateral USDC (Amoy) | `0x9c4e1703476e875070ee25b56a58b008cfb8fa78` | [polymarket-go-contracts AMOY config](https://pkg.go.dev/github.com/ivanzzeth/polymarket-go-contracts@v0.1.0) |
| UMA `OptimisticOracleV2` | `0x38fAc33bD20D4c4Cce085C0f347153C06CbA2968` | [UMA networks/80002.json](https://github.com/UMAprotocol/protocol/blob/master/packages/core/networks/80002.json) |
| UMA `Finder` | `0x28077B47Cd03326De7838926A63699849DD4fa87` | [UMA networks/80002.json](https://github.com/UMAprotocol/protocol/blob/master/packages/core/networks/80002.json) |

> Amoy primitive addresses are from a third-party mirror of the Polymarket
> config — verify each on [amoy.polygonscan.com](https://amoy.polygonscan.com/)
> before a real testnet run. The UMA Amoy values are from UMA's own
> `networks/80002.json` and are authoritative. A Proxy Factory address for Amoy
> is not published; deploy against Polygon mainnet for the canonical setup.

---

## 1. Deploy `UmaCtfAdapter` — trustless UMA settlement

Repo: `uma-ctf-adapter/`. Already `forge build`-ed (ABI in
`uma-ctf-adapter/out/UmaCtfAdapter.sol/UmaCtfAdapter.json`); `forge test` passes.

**Script (the repo's own):** `src/scripts/deploy/DeployAdapter.s.sol`, contract
`DeployAdapter`, entry `deployAdapter(address admin, address ctf, address finder,
address oo)`. It does `new UmaCtfAdapter(ctf, finder, oo)`, grants admin to
`admin`, then renounces the deployer — so the raw deploy has no privileged
deployer left over.

**Runner (the repo's own):** `deploy/scripts/deploy_adapter.sh` — it
`source`s `.env`, runs `forge script DeployAdapter … -s
"deployAdapter(address,address,address,address)" $ADMIN $CTF $FINDER
$OPTIMISTIC_ORACLE`, and prints `Adapter deployed: <addr>`.

### Env vars (from `uma-ctf-adapter/.env.example` + the script)

`.env.example` ships `PK CTF FINDER OPTIMISTIC_ORACLE RPC_URL ETHERSCAN_API_KEY`.
The runner **also references `$ADMIN`**, which is not in `.env.example` — add it.

| Var | Meaning | Value for Polygon 137 |
| --- | --- | --- |
| `PK` | Deployer private key (**secret — never commit**) | your funded deployer key |
| `ADMIN` | Address that receives admin auth on the adapter | your admin/multisig address |
| `CTF` | Gnosis ConditionalTokens | `0x4D97DCd97eC945f40cF65F87097ACe5EA0476045` |
| `FINDER` | UMA Finder (adapter looks up the oracle registry) | `0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64` |
| `OPTIMISTIC_ORACLE` | UMA OptimisticOracleV2 | `0xeE3Afe347D5C74317041E2618C49534dAf887c24` |
| `RPC_URL` | Polygon RPC endpoint | your Polygon RPC |
| `ETHERSCAN_API_KEY` | PolygonScan API key (only if `--verify`) | your key |

For Amoy, substitute the chain-`80002` rows from the table above.

### Run

```bash
cd uma-ctf-adapter
cp .env.example .env          # then fill PK, ADMIN, CTF, FINDER, OPTIMISTIC_ORACLE, RPC_URL
bash deploy/scripts/deploy_adapter.sh
```

Record the printed `Adapter deployed: 0x…` → this is
`NEXT_PUBLIC_ONCHAIN_UMA_ADAPTER`.

To verify on PolygonScan, append `--verify --etherscan-api-key
$ETHERSCAN_API_KEY` to the `forge script` line in the shell script (it is not
verified by default).

---

## 2. Deploy `CTFExchange` — signed-order trading

Repo: `ctf-exchange/`. Already `forge build`-ed (ABI in
`ctf-exchange/out/CTFExchange.sol/CTFExchange.json`).

> The `ctf-exchange` repo is archived upstream (its README points at
> `ctf-exchange-v2`). It still builds, tests, and deploys correctly — you are
> deploying your OWN instance of this exact contract, so the archive notice does
> not block you. If you want the newer exchange, swap in the v2 repo and its own
> script; the app wiring below is identical.

**Script (the repo's own):**
`src/exchange/scripts/ExchangeDeployment.s.sol`, contract `ExchangeDeployment`,
entry `deployExchange(address admin, address collateral, address ctf, address
proxyFactory, address safeFactory)`. It does `new CTFExchange(collateral, ctf,
proxyFactory, safeFactory)`, grants the `admin` both admin + operator roles, then
renounces the deployer's roles.

**Runner (the repo's own):** `deploy/scripts/deploy_exchange.sh
[local|testnet|mainnet]` — picks `.env.local` / `.env.testnet` / `.env`
respectively, then runs `forge script ExchangeDeployment … --with-gas-price
200000000000 -s "deployExchange(address,address,address,address,address)" $ADMIN
$COLLATERAL $CTF $PROXY_FACTORY $SAFE_FACTORY` and prints `Exchange deployed:
<addr>`.

### Env vars (from `ctf-exchange/.env.example`)

`.env.example` ships `PK ADMIN RPC_URL COLLATERAL CTF PROXY_FACTORY SAFE_FACTORY`.

| Var | Meaning | Value for Polygon 137 |
| --- | --- | --- |
| `PK` | Deployer private key (**secret — never commit**) | your funded deployer key |
| `ADMIN` | Address granted admin + operator on the exchange | your admin/operator address |
| `RPC_URL` | Polygon RPC endpoint | your Polygon RPC |
| `COLLATERAL` | ERC-20 collateral (**must equal the app's `NEXT_PUBLIC_ONCHAIN_USDC`**) | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` (native USDC — **app default, use this**) **or** `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174` (USDC.e alternative) |
| `CTF` | Gnosis ConditionalTokens | `0x4D97DCd97eC945f40cF65F87097ACe5EA0476045` |
| `PROXY_FACTORY` | Polymarket proxy-wallet factory | `0xaB45c5A4B0c941a2F231C04C3f49182e1A254052` |
| `SAFE_FACTORY` | Polymarket Gnosis Safe factory | `0xaacFeEa03eb1561C4e67d661e40682Bd20E3541b` |

For Amoy, use the chain-`80002` rows (no published Proxy Factory — prefer
mainnet).

### Run

```bash
cd ctf-exchange
cp .env.example .env          # fill PK, ADMIN, RPC_URL, COLLATERAL, CTF, PROXY_FACTORY, SAFE_FACTORY
bash deploy/scripts/deploy_exchange.sh mainnet   # or: testnet
```

Record the printed `Exchange deployed: 0x…` → this is
`NEXT_PUBLIC_ONCHAIN_EXCHANGE`.

---

## 3. Wire the web app (`oracle/web`)

The viem client in `oracle/web/lib/onchain/` reads all contract addresses from
`NEXT_PUBLIC_*` env (`lib/onchain/addresses.ts`) and reads ABIs from
`lib/onchain/abi/*.json`. All of these are PUBLIC — **no secrets** (private keys
never leave the deploy step). When any REQUIRED var is unset, the on-chain path
stays hidden and the app runs fully on the off-chain (play-money) default.

### Env vars the app expects

Set in `oracle/web/.env.local` (see `oracle/web/.env.local.template`):

| Env var | Required? | Value |
| --- | --- | --- |
| `NEXT_PUBLIC_ONCHAIN_UMA_ADAPTER` | required | your UmaCtfAdapter from step 1 |
| `NEXT_PUBLIC_ONCHAIN_EXCHANGE` | required | your CTFExchange from step 2 |
| `NEXT_PUBLIC_ONCHAIN_CONDITIONAL_TOKENS` | required | `0x4D97DCd97eC945f40cF65F87097ACe5EA0476045` (Polygon CTF) |
| `NEXT_PUBLIC_ONCHAIN_UMA_OPTIMISTIC_ORACLE` | required | `0xeE3Afe347D5C74317041E2618C49534dAf887c24` (Polygon OO v2) |
| `NEXT_PUBLIC_ONCHAIN_USDC` | optional | overrides collateral; **must equal your `COLLATERAL` from step 2**. Omit to use the app default native USDC `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` |
| `NEXT_PUBLIC_RPC_POLYGON` | optional | paid Polygon RPC override; free public PublicNode endpoint used otherwise |

All four required vars must be present together or `getOnchainAddresses()`
returns `null` and `isOnchainEnabled()` is `false` (`lib/onchain/addresses.ts`).
The primary settlement chain is Polygon (`PRIMARY_CHAIN_KEY` in
`lib/onchain/chains.ts`); use the chain-`137` values above.

### ABIs

The client's typed viem bindings live in `oracle/web/lib/onchain/abis.ts` and are
backed by JSON ABIs in `oracle/web/lib/onchain/abi/`:

- `UmaCtfAdapter.json` ← `uma-ctf-adapter/out/UmaCtfAdapter.sol/UmaCtfAdapter.json` (the `abi` array)
- `CTFExchange.json` ← `ctf-exchange/out/CTFExchange.sol/CTFExchange.json` (the `abi` array)
- `ConditionalTokens.json`, `ERC20.json` — the already-live primitives

These are already vendored. If either contract changes, re-run `forge build` in
the repo and re-copy the `abi` array from `out/` — **do not** re-vendor or
rewrite any Solidity.

---

## AMM (instant liquidity) — Fixed Product Market Maker

The order book (CTFExchange, above) needs a counterparty for every fill. For
**instant, always-available liquidity** a market can instead be backed by a
**Fixed Product Market Maker (FPMM)** — a constant-product AMM over the same
Conditional-Tokens YES/NO positions. A market creator seeds a pool once with
`addFunding`; after that anyone can `buy`/`sell` outcome tokens against the pool
at algorithmic prices, no counterparty required.

The FPMM is Predikt's own copy of the Gnosis
`FixedProductMarketMaker` + `FPMMDeterministicFactory` contracts, in
[`fpmm/`](./fpmm). It is Solidity `^0.5.1`; **the AMM pricing math
(`calcBuyAmount` / `calcSellAmount` / `buy` / `sell` / `addFunding`) is the
UNCHANGED upstream Gnosis implementation** (see `fpmm/NOTICE`). It builds with
Foundry (`forge` auto-selects solc 0.5.x from the `foundry.toml`) — no Truffle
needed:

```bash
cd fpmm && forge build     # or: npm run build:forge
```

### How a market creator seeds a pool with `addFunding`

The `FPMMDeterministicFactory.create2FixedProductMarketMaker(...)` call does the
whole thing in **one transaction**: it clones a `FixedProductMarketMaker`, wires
it to your `ConditionalTokens` + collateral + `conditionId`, and — if
`initialFunds > 0` — pulls the collateral and calls `addFunding` to seed the
pool. The pool address is emitted in the `FixedProductMarketMakerCreation` event.

`addFunding(addedFunds, distributionHint)` semantics:

- On the **first** funding, `distributionHint` sets the starting odds. For a
  binary market, `[1, 1]` = 50/50 (YES ≈ NO ≈ 0.50). A skewed hint (e.g.
  `[2, 1]`) starts YES cheaper/NO pricier. The funder receives LP shares equal
  to `addedFunds` and any "unbalanced" outcome tokens are sent back to them.
- On **subsequent** fundings, `distributionHint` MUST be empty (`[]`); the pool
  adds liquidity in proportion to current balances and mints LP shares pro-rata.
- LP shares accrue the `fee` (basis points) charged on every trade; the funder
  redeems liquidity + earned fees later via `removeFunding` / `withdrawFees`.

**Fee:** passed to the factory as an 18-dp fraction. The deploy driver takes it
as `FEE_BPS` (basis points) and converts — e.g. `FEE_BPS=200` → `2e16` = **2%**.

### Deploy an FPMM pool

Solidity `^0.5.1` can't share the `^0.8` `forge-std` `Script`, so the deploy
driver is a small env-parameterized Node + viem script
([`fpmm/script/deploy-fpmm.mjs`](./fpmm/script/deploy-fpmm.mjs)) that calls the
factory's own create pattern. It works on anvil, a testnet, or Polygon — point
it at the **already-live** ConditionalTokens + your collateral + a `conditionId`
you prepared via the UMA adapter (or `prepareCondition` directly).

```bash
cd fpmm
node test-e2e/setup-deps.mjs           # one-time: links viem from predikt-relay/node_modules

RPC_URL=https://polygon-rpc.com \
DEPLOYER_PK=0x…              \  # sends txs + provides the seed collateral
CTF_ADDRESS=0x4D97DCd97eC945f40cF65F87097ACe5EA0476045 \   # Polygon CTF
COLLATERAL_ADDRESS=0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359 \ # native USDC
CONDITION_ID=0x… \          # from prepareCondition / the UMA adapter
FEE_BPS=200 \               # 2%
INITIAL_FUNDS=1000 \        # seed 1,000 USDC of liquidity (omit/0 = create unseeded)
node script/deploy-fpmm.mjs
```

Optional env: `FACTORY_ADDRESS` (reuse an existing factory instead of deploying
a fresh one), `DISTRIBUTION_HINT` (e.g. `1,1`), `SALT_NONCE`,
`COLLATERAL_DECIMALS`, `CHAIN_ID`. The script prints `FPMM_POOL` and
`FPMM_FACTORY`; feed `FPMM_POOL` to the app so the AMM path can `calcBuyAmount` /
`buy` / `sell` against it.

### Proof it works — local anvil E2E

[`fpmm/test-e2e/run.mjs`](./fpmm/test-e2e/run.mjs) mirrors the relay's e2e: it
spins up **anvil**, deploys **USDC(6dp) + ConditionalTokens + the FPMM factory**,
`prepareCondition`s a binary market, creates + seeds a pool with `addFunding`,
then has a taker `calcBuyAmount` → `buy` YES and `sell` it back — asserting the
**real on-chain balances** at every step (YES received, USDC spent/returned, the
constant-product price impact). Run it:

```bash
cd fpmm && npm run e2e:amm
```

Last verified run: **18/18 checks passed** — a 1,000-USDC 50/50 pool quoted
`187.253187 YES` for a 100-USDC buy (below the 196-YES flat-price ideal, proving
the curve's price impact + 2% fee), and a subsequent `sell` returned 90 USDC for
`174.964409 YES`.
