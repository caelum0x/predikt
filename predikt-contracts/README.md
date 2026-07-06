# Predikt — on-chain layer

This is **Predikt's on-chain layer**: the smart contracts and order SDK that make Predikt
prediction markets settle and trade non-custodially on-chain. Every package here is **Predikt's own
first-class code** (MIT licensed). It originated from Polymarket's open-source contracts and SDK and
has been adopted, rebranded, and integrated into Predikt — not vendored as read-only clones.

## The three pieces

| Concern       | Package                                | What it does |
| ------------- | -------------------------------------- | ------------ |
| **Settlement** | [`uma-ctf-adapter`](./uma-ctf-adapter) | Resolves markets trustlessly via UMA's Optimistic Oracle, then settles the Conditional Tokens Framework (CTF) condition. Foundry / Solidity. |
| **Trading**    | [`ctf-exchange`](./ctf-exchange)       | Non-custodial `CTFExchange` — atomic swaps of CTF ERC-1155 outcome tokens against ERC-20 collateral via `fillOrder` / `fillOrders` / `matchOrders`. Foundry / Solidity. |
| **Orders**     | [`@predikt/orders`](./clob-client)     | TypeScript SDK that builds and **EIP-712 signs real orders** for `CTFExchange`. Order construction + signing core (hosted-CLOB HTTP client trimmed). |

## How it fits together

```
                       markets created / questions asked
                                     │
                                     ▼
   ┌───────────────────────────────────────────────────────────────┐
   │  Conditional Tokens Framework (CTF)  —  ERC-1155 outcome tokens │
   └───────────────────────────────────────────────────────────────┘
        ▲ prepare / resolve condition            ▲ swap outcome tokens
        │                                        │
┌───────────────────┐                  ┌──────────────────────┐
│  uma-ctf-adapter  │                  │     ctf-exchange     │
│   (SETTLEMENT)    │                  │      (TRADING)       │
│  UMA Optimistic   │                  │  matchOrders /       │
│  Oracle → resolve │                  │  fillOrder (on-chain)│
└───────────────────┘                  └──────────────────────┘
                                                 ▲
                                                 │ real EIP-712 signed orders
                                        ┌──────────────────────┐
                                        │   @predikt/orders    │
                                        │      (ORDERS)        │
                                        │ OrderBuilder + EIP712 │
                                        │ typed-data signing    │
                                        └──────────────────────┘
```

1. A market is created and `initialized` on the **adapter**, which `prepares` the CTF condition and
   requests resolution data from UMA's Optimistic Oracle.
2. Traders build orders with **`@predikt/orders`** and sign them with a real EIP-712 signature over
   the exchange's domain. Predikt's backend matches orders off-chain.
3. Matched orders settle **on-chain** through the **`ctf-exchange`** (`matchOrders` / `fillOrder`) —
   real transactions, no mocked or faked fills.
4. When the market outcome is known, UMA returns resolution data and anyone can `resolve` the
   condition on the **adapter**, settling the CTF outcome tokens.

## The load-bearing constant

Orders are signed and verified under the EIP-712 domain:

```
name              = "Polymarket CTF Exchange"
version           = "1"
chainId           = <network chain id>
verifyingContract = <CTFExchange address>
```

This domain name/version, and the `Order` struct field order, are part of the **on-chain signature
scheme** that deployed contracts depend on. They are the same string in the Solidity contract
(`ctf-exchange/src/exchange/CTFExchange.sol`) and the TS SDK
(`clob-client/src/order-utils/exchange.order.const.ts`), and are **intentionally left unchanged** —
altering them would invalidate every existing order signature. Predikt's changes are
surface/branding/packaging only; the audited settlement and trading logic is untouched.

## Workspace

The two Solidity packages keep their own self-contained Foundry setup (each with its own `lib/`
submodules), so `forge build` / `forge test` work from inside each directory. A root
[`foundry.toml`](./foundry.toml) declares named profiles (`settlement`, `trading`) and a root
[`Makefile`](./Makefile) drives everything as one workspace:

```bash
make build   # forge build both Solidity packages
make test    # forge test the settlement suite (61+ tests)

make build-orders   # pnpm build @predikt/orders (TypeScript SDK)
make test-orders     # type-check the SDK
```

### Verified green

- `uma-ctf-adapter`: `forge build` ✅, `forge test` ✅ — **72 tests pass** (61 in the adapter suite)
- `ctf-exchange`: `forge build` ✅, `forge test` ✅ — **78 tests pass**
- `@predikt/orders`: `pnpm build` ✅, `pnpm typecheck` ✅, **318 order/signing tests pass** (real
  EIP-712 signatures across every tick size and signature path)

## License

MIT. See each package's `LICENSE` / `LICENSE.md`. Originally authored by Polymarket; adopted and
maintained as Predikt's own code.

## Deployment

See [`DEPLOY.md`](./DEPLOY.md). Each Solidity package keeps its own working deploy script:
- Settlement: `uma-ctf-adapter/src/scripts/deploy/DeployAdapter.s.sol`
- Trading: `ctf-exchange/src/exchange/scripts/ExchangeDeployment.s.sol`

Configure via each package's `.env` (see the `.env.example` files). No secrets are committed.
