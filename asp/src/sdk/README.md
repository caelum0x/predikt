# Predikt Oracle SDK

A typed TypeScript client for the Predikt Oracle ASP. One import drives the
whole service — accounts, markets, trading, limit orders, portfolios, stats,
the AI tools, and x402 deposits — with no hand-written HTTP. Every method
returns the unwrapped `data` payload and throws `PrediktApiError` (carrying the
HTTP `status`) on any failure.

Depends only on `zod` and a `fetch`-compatible transport. The x402 signer
additionally uses `viem`.

## Quickstart

```ts
import { PrediktClient } from './client'

// Create an account (the API key is shown once — store it).
const { client, apiKey } = await PrediktClient.signup(
  'https://predikt-oracle.fly.dev',
  'my-agent'
)

// Or reuse an existing key:
const c = new PrediktClient({ baseUrl: 'https://predikt-oracle.fly.dev', apiKey })

// Create a market, trade it, resolve it.
const market = await client.createMarket({
  question: 'Will BTC close above $150k on Dec 31, 2026?',
  criteria: 'Resolves YES on a CoinGecko daily close above $150,000.',
  closeTime: Date.now() + 90 * 24 * 60 * 60 * 1000,
  initialProb: 0.4,
  subsidy: 100,
})

const quote = await client.quote(market.id, 'YES', 50)
const trade = await client.buy(market.id, { side: 'YES', amount: 50 })
await client.resolve(market.id, 'YES') // creator only
```

## Multiple-choice markets

```ts
const m = await client.createMarket({
  question: 'Which team wins the final?',
  criteria: 'Resolves to the winning team per the official result.',
  closeTime: Date.now() + 30 * 864e5,
  outcomeType: 'MULTI',
  answers: ['Red', 'Blue', 'Green'],
})
const blue = m.answers!.find((a) => a.text === 'Blue')!
await client.buy(m.id, { side: 'YES', amount: 30, answerId: blue.id })
await client.resolve(m.id, blue.id) // winning answer id
```

## AI tools

```ts
const drafts = await client.draftMarket({ topic: 'the 2026 F1 season' })
const odds = await client.estimateOdds({
  question: 'Will the Fed cut rates before October 2026?',
  deadline: '2026-10-01',
})
const verdict = await client.suggestResolution({
  question: 'Did team X win the final?',
  sources: ['Official result: X won 3-1.'],
})
```

## x402 deposits

Deposits use the x402 payment protocol (EIP-3009 USDT on X Layer). Ask for a
deposit, sign the returned requirements with a viem account, then retry.

```ts
import { privateKeyToAccount } from 'viem/accounts'
import { buildPaymentHeader } from './x402-signer'

const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`)

const challenge = await client.deposit(25) // 25 credits (= 25 USDT)
if (challenge.kind === 'payment-required') {
  const header = await buildPaymentHeader({
    account,
    requirements: challenge.requirements,
  })
  const done = await client.deposit(25, header)
  if (done.kind === 'completed') {
    console.log('new balance:', done.balance)
  }
}
```

## Error handling

```ts
import { PrediktApiError } from './client'

try {
  await client.buy(marketId, { side: 'YES', amount: 1_000_000 })
} catch (err) {
  if (err instanceof PrediktApiError) {
    // err.status: 402 (insufficient balance), 404 (no market), 401 (no key), ...
    console.error(err.status, err.message)
  }
}
```

## Testing against an in-process app

Inject `fetchFn` to run the SDK against a Hono app with no network:

```ts
const app = createApp({ db: openDb(':memory:'), complete })
const client = new PrediktClient({
  baseUrl: 'http://test',
  fetchFn: (url, init) => app.request(url, init),
})
```
