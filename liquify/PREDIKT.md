# Running liquify as Predikt's liquidity companion service

`liquify` is an MIT-licensed automated market-maker bot (upstream: a Manifold
market-maker). It places pairs of limit orders above and below the current
market price on binary markets, which supplies **liquidity** to Predikt and can
earn a profit when the market is volatile (buy low / sell high). We run it
**unchanged** as a separate Node process against the Predikt/oracle backend API.

> This is a **companion service**, not part of the web app. It runs on its own
> (a laptop, a cron box, a small VM, a container) and talks to the public
> backend HTTP API using an API key. It does not import from, and is not
> imported by, the Predikt web/backend. Nothing here adds a runtime dependency
> on the bot.

## How it works (short version)

1. Fetches all your existing bets, then all open **BINARY**, unresolved markets.
2. For markets with at least ~10 non-limit bets (i.e. real activity), it computes
   an exponential moving average + variance of the probability and places two
   pairs of YES/NO limit orders straddling the current price.
3. Order size scales with `log(volume)`; wider markets get wider spreads.
   Orders too close to 0 or 1 (`<=0.001` or `>=0.999`) are skipped.

The bot targets **every** eligible open binary market on the instance. There is
no per-market allow-list in the upstream code — scope is controlled by which
markets are open + the "≥10 bets" activity filter. Keep the funded balance
modest to bound exposure (see Safe defaults).

## Backend compatibility (verified)

The bot's API contract already matches the Predikt/oracle backend exactly:

| Concern            | liquify (`src/api.ts`)                | oracle backend                          |
|--------------------|---------------------------------------|-----------------------------------------|
| Auth header        | `Authorization: Key <apiKey>`         | `Key <apiKey>` (`backend/discord-bot`)  |
| Place order        | `POST /v0/bet` `{contractId, outcome, amount, limitProb}` | `POST /v0/bet` (`docs/docs/api.md`) |
| Cancel order       | `POST /v0/bet/cancel/:id`             | same                                    |
| Read markets/bets  | `GET /v0/markets`, `/v0/market/:id`, `/v0/bets` | same                          |
| Prod base URL      | `https://api.oracle.markets/v0`       | `apiEndpoint: api.oracle.markets`       |
| Dev base URL       | `https://api.dev.oracle.markets/v0`   | `apiEndpoint: api.dev.oracle.markets`   |

The only integration change made to the repo: `API_URL` in `src/api.ts` now
reads `process.env.ORACLE_API_URL` (defaulting to prod), so you can point it at
dev without editing code. No bot logic was rewritten and no dependency was added.

## Configuration (env)

Create a `.env` file in this directory (it is git-ignored — **do not commit it**;
never commit the API key):

```
# Predikt/oracle API key. Get it from the Predikt app:
#   your profile => Edit => API key
MANIFOLD_API_KEY=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

# The username of the account that owns the API key above.
MANIFOLD_USERNAME=YourPrediktUsername

# Which backend to hit. Omit for prod. Set to dev while testing.
# Prod (default): https://api.oracle.markets/v0
# Dev:            https://api.dev.oracle.markets/v0
ORACLE_API_URL=https://api.dev.oracle.markets/v0
```

The `MANIFOLD_*` names are the upstream variable names (the bot originally
targeted Manifold); they are the account credentials for **Predikt** here. We
kept the names to avoid rewriting the bot.

## Run it

```bash
# from /Users/arhansubasi/expo games and apps/prediction/liquify
yarn            # install deps (dotenv, lodash, node-fetch)
yarn start      # runs src/market-maker.ts via ts-node (a long-ish batch pass)
```

`yarn start` performs **one full pass**: place/refresh limit orders across
eligible markets, then exit. To keep providing liquidity continuously, run it on
a schedule rather than as a resident daemon — e.g. cron every 15–60 minutes:

```
*/30 * * * * cd "/path/to/liquify" && /usr/local/bin/yarn start >> liquify.log 2>&1
```

### Resetting / pulling liquidity

`src/market-maker.ts` has a `mode` switch near the top:

```ts
const mode = true ? 'ADD_BETS' : 'RESET'
```

- `ADD_BETS` (default) — place/refresh limit orders.
- `RESET` — cancel all of the account's open limit orders (flip the ternary to
  `false`), useful to withdraw liquidity or clean up before changing strategy.

## Safe defaults / operating guidance

- **Start on dev.** Set `ORACLE_API_URL=https://api.dev.oracle.markets/v0` and a
  dev account first; confirm orders look sane before pointing at prod.
- **Bound exposure via balance, not code.** The bot will act on every eligible
  open binary market and order size grows with market volume. The simplest,
  safest throttle is to fund the bot account with a modest balance so total
  outstanding orders are naturally capped. Top up deliberately.
- **Dedicated account.** Use a separate Predikt account for the bot so its
  positions/API key are isolated and easy to `RESET`.
- **Low concurrency already built in.** Market processing is batched
  (`batchedWaitAll(..., 2)`) to stay gentle on the API — leave it as-is.
- **Watch the first runs.** Tail the log and spot-check a few markets in the
  Predikt UI to confirm spreads/limit prices are reasonable for the instance.
- **Rotate the key** if it is ever exposed, and keep `.env` out of git.
```
