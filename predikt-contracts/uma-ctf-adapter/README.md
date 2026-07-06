# Predikt UMA CTF Adapter (settlement)

Part of [Predikt's on-chain layer](../README.md). MIT licensed. This is Predikt's own code —
originally authored by Polymarket and adopted here as a first-class Foundry package.

## Overview

This package contains the contracts that **settle** Predikt prediction markets. It is an
[oracle](https://github.com/gnosis/conditional-tokens-contracts) to
[Conditional Tokens Framework (CTF)](https://docs.gnosis.io/conditionaltokens/) conditions,
resolving them trustlessly using UMA's
[Optimistic Oracle](https://docs.umaproject.org/oracle/optimistic-oracle-interface).

Trading of the resulting CTF outcome tokens is handled by the sibling
[`ctf-exchange`](../ctf-exchange) package; orders are built and signed with the
[`@predikt/orders`](../clob-client) SDK.

## How settlement works

When a new market is deployed, it is `initialized`, meaning:
1) The market's parameters (ancillary data, request timestamp, reward token, reward, etc.) are stored on-chain
2) The market is `prepared` on the CTF contract
3) A resolution data request is sent to the Optimistic Oracle

UMA proposers respond off-chain. If the resolution data is not disputed, it becomes available to
the adapter after a liveness period (currently ~2 hours).

The first time a request is disputed, the market is automatically `reset` (a new Optimistic Oracle
request is sent), so obviously incorrect disputes don't slow down resolution.

If disputed again, this signals a fundamental disagreement and the Optimistic Oracle falls back to
UMA's [DVM](https://docs.umaproject.org/getting-started/oracle#umas-data-verification-mechanism),
which returns data after a 48–72 hour period.

Once resolution data is available, anyone can call `resolve` to settle the market.

## Audit

The underlying contracts were audited by OpenZeppelin; the report is available
[here](./audit/Polymarket_UMA_Optimistic_Oracle_Adapter_Audit.pdf). Predikt's changes are
surface/branding only — the audited settlement logic and interfaces are unchanged.

## Development

Install [Foundry](https://github.com/foundry-rs/foundry/) (`foundryup` to update `forge`/`cast`).

- Build: `forge build`
- Test: `forge test` (61+ tests, all green)

Deployment uses the script in `src/scripts/deploy/DeployAdapter.s.sol`; configure via `.env`
(see `.env.example`).
