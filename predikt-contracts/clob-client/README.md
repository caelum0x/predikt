# @predikt/orders

Predikt's on-chain **order SDK**. Part of [Predikt's on-chain layer](../README.md). MIT licensed.
This is Predikt's own code — originally Polymarket's `clob-client`, adopted here as a first-class
package and trimmed to the order-construction + signing core.

It builds and **EIP-712 signs real orders** for the [`ctf-exchange`](../ctf-exchange) contract. The
signed orders are matched on-chain via `CTFExchange.matchOrders` / `fillOrder` — there are no mock
or faked fills.

## What's in the package

- `order-builder/` — `OrderBuilder` high-level API (`buildOrder`, `buildMarketOrder`) plus rounding
  and amount helpers.
- `order-utils/` — `ExchangeOrderBuilder` (the EIP-712 typed-data builder, order hashing and
  signing) and the order models.
- `signer.ts` — signer abstraction supporting ethers `Wallet` and viem `WalletClient`.
- `config.ts`, `types.ts`, `utilities.ts` — chain/contract config, shared types, rounding utils.

The upstream **hosted-CLOB HTTP client** (`ClobClient`, the RFQ client, HTTP helpers, API auth
headers/HMAC and the `axios` / builder-signing dependencies) has been removed. Predikt talks to its
own backend and settles on-chain, so those pieces added weight without value here.

## EIP-712 order scheme (must match the exchange — unchanged)

Orders are signed under the domain used by the deployed exchange:

```
name              = "Polymarket CTF Exchange"   // load-bearing on-chain constant
version           = "1"
chainId           = <network chain id>
verifyingContract = <CTFExchange address>
```

and the `Order` struct field order in `order-utils/exchange.order.const.ts` matches the Solidity
`ORDER_TYPEHASH` in `ctf-exchange/src/exchange/libraries/OrderStructs.sol` exactly. **These are left
unchanged** so signatures produced here verify against the deployed contract.

## Usage

```ts
import { OrderBuilder, OrderSide, SignatureType } from "@predikt/orders";
import { Wallet } from "@ethersproject/wallet";

const builder = new OrderBuilder(new Wallet(process.env.PK!), 137, SignatureType.EOA);

const signedOrder = await builder.buildOrder(
    { tokenID: "<CTF outcome token id>", price: 0.55, side: OrderSide.BUY, size: 100 },
    { tickSize: "0.01", negRisk: false },
);
// signedOrder -> matched on-chain via CTFExchange.matchOrders / fillOrder
```

A viem `WalletClient` may be passed instead of an ethers `Wallet`. See
[`examples/buildSignedOrder.ts`](examples/buildSignedOrder.ts).

## Development

```bash
pnpm install
pnpm build       # tsc -> dist/
pnpm typecheck   # type-check src + tests
pnpm test        # typecheck + vitest (order-builder / order-utils / utilities)
```
