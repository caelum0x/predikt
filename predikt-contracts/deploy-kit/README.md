# Predikt deploy-kit — guided, ordered go-live

One command wraps the repos' **OWN** deploy scripts into a correct, ordered flow so
an operator can take the on-chain stack live with minimal steps. It writes **no
Solidity** and **no new deploy contracts** — it orchestrates the existing ones and
grants the relay operator role, then hands you the exact env blocks to paste.

> **REAL only.** Real `forge` broadcasts, real `cast` calls, real `viem` deploy for
> the FPMM factory. It will **not** run against a live chain without the operator's
> **funded key + gas** — but it is fully **dry-runnable** so you can rehearse the
> whole flow first. No secrets are ever written to disk.

## What it does, in order

| Step | Action | Wraps (repo's own) |
|---|---|---|
| 1 | Deploy **CTFExchange** (collateral = native USDC, to match the web app) | `ctf-exchange/src/exchange/scripts/ExchangeDeployment.s.sol` via `forge script` |
| 2 | Deploy **UmaCtfAdapter** (real ConditionalTokens + real UMA Finder + OptimisticOracleV2) | `uma-ctf-adapter/src/scripts/deploy/DeployAdapter.s.sol` via `forge script` |
| 3 | Deploy the **FPMM factory** (Predikt's own `FPMMDeterministicFactory`) | `fpmm/script/deploy-fpmm.mjs` pattern (viem `deployContract`) |
| 4 | Grant the **relay operator** the exchange **operator role** | `CTFExchange.addOperator(operator)` via `cast send` + `isOperator` verify |
| 5 | Collect every address into `addresses.<chain>.json` (PUBLIC only) | — |
| 6 | Emit the three **env blocks** to paste (oracle/web, relay, market maker) | — |

Only the **factory** is deployed in step 3 — per-market FPMM pools are created later
from that factory with `fpmm/script/deploy-fpmm.mjs` (`create2FixedProductMarketMaker`),
one per market, once you have a `conditionId`.

## Prerequisites

- `forge`, `cast`, `node` on PATH (Foundry + Node ≥ 18).
- `jq` (only if you re-run the repos' own shell wrappers directly).
- The relay's deps installed once so `viem` is available to link:
  `(cd ../../predikt-relay && npm install)`. The kit's `setup-deps.mjs` symlinks
  `viem` from there — no separate install.

## Usage

```bash
cd predikt-contracts/deploy-kit

# 0. one-time: link viem from predikt-relay/node_modules
node setup-deps.mjs

# 1. DRY RUN first (recommended) — simulate end-to-end, broadcast nothing:
node deploy.mjs --chain amoy --dry-run

# 2. Real TESTNET deploy (Amoy) — needs a funded key + gas:
PRIVATE_KEY=0x…            \  # funded deployer (secret; never committed)
RELAY_OPERATOR=0x…         \  # the relay operator EOA to grant (defaults to deployer)
RPC=https://rpc-amoy.polygon.technology \
node deploy.mjs --chain amoy

# 3. Real MAINNET deploy (Polygon) — only after Amoy is verified:
PRIVATE_KEY=0x… RELAY_OPERATOR=0x… RPC=https://your-polygon-rpc \
node deploy.mjs --chain polygon
```

Convenience npm scripts: `npm run dry:amoy`, `npm run deploy:amoy`,
`npm run dry:polygon`, `npm run deploy:polygon` (each runs `setup-deps` first).

### Env

| Var | Required | Meaning |
|---|---|---|
| `PRIVATE_KEY` | for real runs | 0x deployer key, funded on the target chain. **Secret — never committed.** Dry-run without it uses the anvil default test key (address only). |
| `RPC` | optional | JSON-RPC endpoint. Falls back to the chain's public default (set a paid RPC for reliability — the public Polygon endpoint may 401). |
| `RELAY_OPERATOR` / `OPERATOR_ADDRESS` | optional | Relay operator EOA to grant the operator role. Defaults to the deployer address (single-operator setup). |
| `EXCHANGE_ADMIN` | optional | Exchange admin. **Defaults to the deployer** so it keeps admin and can run step 4 (see below). |
| `COLLATERAL` | optional | Override collateral. Defaults to the chain's **native USDC** (matches `NEXT_PUBLIC_ONCHAIN_USDC`). |
| `ETHERSCAN_API_KEY` | optional | With `--verify`, forge verifies the two contracts on the explorer. |

## Auth model (important, real behaviour)

`ExchangeDeployment.deployExchange(admin, …)` grants **admin + operator** to `admin`
and then **renounces the deployer's** roles. So `addOperator` in step 4 must come
from an account that is **still admin**. The kit therefore sets `ADMIN = the
deployer's own address` by default, so the deployer key retains admin and performs
step 4 in the same run.

If you pass a separate `EXCHANGE_ADMIN`, the deployer has no admin left after step 1,
so the kit **does not** send `addOperator` (it can't — it doesn't hold the external
admin key). It prints the exact `cast send … addOperator(address) <operator>` command
to run from that admin key instead.

## Idempotency & safety

- **Testnet first.** Always `--chain amoy` (and `--dry-run` before that) before Polygon.
- **Verify addresses.** After a real run, verify each printed address on the block
  explorer before pointing users at it. The Amoy primitive addresses come from a
  third-party mirror — confirm on amoy.polygonscan.com (see `../DEPLOY.md`).
- **Re-runs deploy fresh instances.** Running the kit again deploys *new* Exchange /
  Adapter / factory instances (they are not create2-pinned here). `addOperator` is
  idempotent (granting an existing operator is a no-op). To reuse existing contracts,
  don't re-run — reuse the recorded `addresses.<chain>.json`.
- **No secrets on disk.** `addresses.<chain>.json` contains only PUBLIC addresses.
  Private keys stay in the environment and are passed straight to `forge`/`cast`/`viem`;
  they are never logged or written. The emitted env blocks show keys as placeholders
  only.

## Outputs

- `addresses.<chain>.json` — every deployed + primitive address (PUBLIC). A dry-run
  sample is committed as `addresses.amoy.json` (note `"dryRun": true` and the
  `0xPENDING_*` markers, which a live run replaces with real addresses).
- Three env blocks printed to stdout: `oracle/web/.env.local` (`NEXT_PUBLIC_ONCHAIN_*`),
  `predikt-relay/.env` (relay operator), and the market-maker `MM_*` half.

## Reused from the existing repos (nothing re-implemented)

- `ctf-exchange` / `uma-ctf-adapter` **forge deploy scripts** — invoked as-is.
- `fpmm/script/deploy-fpmm.mjs` factory-deploy **pattern** + `fpmm/out` artifact.
- `predikt-relay/node_modules/viem` — linked, not re-installed.
- Chain primitive addresses — mirrored from `../DEPLOY.md`.
