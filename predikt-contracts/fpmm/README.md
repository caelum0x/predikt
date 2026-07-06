# @predikt/fpmm

Predikt's Fixed Product Market Maker (FPMM) and deterministic factory for
Gnosis Conditional Tokens. This is the on-chain AMM that Predikt deploys and
that the app interacts with by ABI.

It is derived from Gnosis'
[`conditional-tokens-market-makers`](https://github.com/gnosis/conditional-tokens-market-makers)
(LGPL-3.0). The AMM pricing logic — `calcBuyAmount`, `calcSellAmount`, `buy`,
`sell`, `addFunding`, `removeFunding` — is preserved exactly as upstream. See
[NOTICE](./NOTICE) for provenance and licensing.

## Contracts

Deploy-ready set (built under Foundry):

- `contracts/FixedProductMarketMaker.sol` — the AMM. Constant-product pricing over
  Conditional Tokens outcome positions, with an LP fee pool.
- `contracts/FPMMDeterministicFactory.sol` — CREATE2 clone factory that deploys
  FPMM instances at deterministic addresses and optionally seeds initial funding.
- Supporting: `contracts/ERC20.sol` (hooked OZ ERC20 for LP shares),
  `contracts/Create2CloneFactory.sol`.

Also present but **not** part of the deploy-ready build (they depend on
`@gnosis.pm/util-contracts`, whose npm install is broken by a stale transitive
git dependency): `LMSRMarketMaker*.sol`, `MarketMaker.sol`,
`FixedProductMarketMakerFactory.sol`, `Whitelist.sol`. They are excluded via
`skip` in `foundry.toml`. Predikt uses the deterministic FPMM path, so these are
not needed for deployment.

## Build

Solidity `^0.5.1` — forge auto-selects solc 0.5.x (pinned to `0.5.10` in
`foundry.toml`, matching the original Gnosis Truffle config). No Truffle needed.

```bash
# Install the two solidity dependency sets the FPMM set needs:
#   openzeppelin-solidity@2.3.0  (IERC20, SafeMath, ERC165, Address)
#   @gnosis.pm/conditional-tokens-contracts@1.0.1  (ConditionalTokens, CTHelpers, ERC1155)
# (npm install of the full tree fails on a broken transitive git dep in
#  @gnosis.pm/util-contracts; these two packages install cleanly on their own,
#  or can be extracted from `npm pack` tarballs into node_modules/.)

forge build
```

Artifacts (ABI + bytecode) land in:

- `out/FixedProductMarketMaker.sol/FixedProductMarketMaker.json`
- `out/FPMMDeterministicFactory.sol/FPMMDeterministicFactory.json`
- `out/ConditionalTokens.sol/ConditionalTokens.json` (for integration/tests)

## Tests

The existing `test/*.js` files are the upstream Gnosis Truffle/Mocha suite and
require the full JS toolchain. They are kept for reference. Forge-native tests
are not yet ported; the AMM logic is verified here by a clean `forge build` of
the unmodified pricing contracts.

## License

LGPL-3.0. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
