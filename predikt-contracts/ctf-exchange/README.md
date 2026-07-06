# Predikt CTF Exchange (trading)

Part of [Predikt's on-chain layer](../README.md). MIT licensed. This is Predikt's own code —
originally authored by Polymarket and adopted here as a first-class Foundry package.

## Background

The Predikt CTF Exchange is an exchange protocol that facilitates atomic swaps between
[Conditional Tokens Framework (CTF)](https://docs.gnosis.io/conditionaltokens/) ERC1155 outcome
tokens and an ERC20 collateral asset.

It uses a hybrid-decentralized model: an operator provides off-chain order matching while
**settlement happens on-chain, non-custodially** via `fillOrder`, `fillOrders`, and `matchOrders`.
Orders are real EIP-712 signed messages built with the [`@predikt/orders`](../clob-client) SDK, and
markets are settled by the sibling [`uma-ctf-adapter`](../uma-ctf-adapter) package.

## EIP-712 domain (load-bearing — do not change)

The exchange signs orders under the EIP-712 domain `name = "Polymarket CTF Exchange"`,
`version = "1"` (see `src/exchange/CTFExchange.sol` and `src/exchange/mixins/Hashing.sol`). This
string is part of the on-chain signature scheme that deployed contracts and the `@predikt/orders`
signer both rely on. It is intentionally left unchanged so existing order signatures remain valid.

## Documentation

Protocol docs are in [`docs/Overview.md`](./docs/Overview.md).

## Audit

The underlying contracts were audited by ChainSecurity; the report is available
[here](./audit/ChainSecurity_Polymarket_Exchange_audit.pdf). Predikt's changes are surface/branding
only — the audited trading logic and the EIP-712 order scheme are unchanged.

## Development

Install [Foundry](https://github.com/foundry-rs/foundry/) (`foundryup` to update `forge`/`cast`).

- Build: `forge build`
- Test: `forge test` (matching by name: `forge test -m PATTERN`; by contract: `forge test --mc PATTERN`)

Deployment uses `src/exchange/scripts/ExchangeDeployment.s.sol`; configure via `.env`
(see `.env.example`).
