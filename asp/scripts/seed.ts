// Seeds a database with demo data so the dashboard and feed look alive for
// the hackathon demo. Idempotent-ish: run against a fresh DB for best results.
//
//   DB_PATH=predikt-oracle.db npx tsx scripts/seed.ts
//
// Prints the created API keys (store them — keys are hashed at rest).

import { openDb } from '../src/engine/store'
import { MarketService } from '../src/engine/service'

const DAY = 24 * 60 * 60 * 1000

const MARKETS: {
  question: string
  criteria: string
  category: string
  daysOut: number
  initialProb?: number
  outcomeType?: 'BINARY' | 'MULTI'
  answers?: string[]
}[] = [
  {
    question: 'Will BTC close above $150k on Dec 31, 2026?',
    criteria: 'Resolves YES if the CoinGecko BTC/USD daily close on 2026-12-31 exceeds $150,000.',
    category: 'Crypto',
    daysOut: 170,
    initialProb: 0.35,
  },
  {
    question: 'Will the Fed cut rates at the September 2026 FOMC meeting?',
    criteria: 'Resolves YES if the FOMC statement of Sep 2026 announces a federal funds target range lower than the prior meeting.',
    category: 'Finance',
    daysOut: 65,
    initialProb: 0.55,
  },
  {
    question: 'Will a Claude 5-family model top LMArena on Aug 1, 2026?',
    criteria: 'Resolves YES if any Anthropic Claude 5 model ranks #1 overall on lmarena.ai at 00:00 UTC on 2026-08-01.',
    category: 'AI',
    daysOut: 17,
    initialProb: 0.45,
  },
  {
    question: 'Which league wins the 2026 club world treble race?',
    criteria: 'Resolves to the league of the first club to complete a domestic league + cup + continental treble in the 2026-27 season; CANCEL if none by Jul 1, 2027.',
    category: 'Sports',
    daysOut: 300,
    outcomeType: 'MULTI',
    answers: ['Premier League', 'La Liga', 'Serie A', 'Bundesliga', 'Other'],
  },
]

async function main() {
  const db = openDb(process.env.DB_PATH || 'predikt-oracle.db')
  const svc = new MarketService(db)

  const creator = svc.createAccount('Predikt Curator')
  const traderA = svc.createAccount('Momentum Agent')
  const traderB = svc.createAccount('Contrarian Agent')

  const now = Date.now()
  for (const spec of MARKETS) {
    const market = svc.createMarket(creator.account.id, {
      question: spec.question,
      criteria: spec.criteria,
      category: spec.category,
      closeTime: now + spec.daysOut * DAY,
      subsidy: 100,
      ...(spec.outcomeType === 'MULTI'
        ? { outcomeType: 'MULTI' as const, answers: spec.answers }
        : { initialProb: spec.initialProb }),
    })

    // A few opposing trades so probabilities move off their starting points.
    if (market.outcomeType === 'BINARY') {
      svc.buy(traderA.account.id, market.id, 'YES', 25)
      svc.buy(traderB.account.id, market.id, 'NO', 15)
      svc.buy(traderA.account.id, market.id, 'YES', 10)
    }
    console.error(`seeded ${market.id}  ${market.question}`)
  }

  console.error('\nAPI keys (shown once):')
  console.error(`  curator:    ${creator.apiKey}`)
  console.error(`  trader A:   ${traderA.apiKey}`)
  console.error(`  trader B:   ${traderB.apiKey}`)
}

main().catch((err) => {
  console.error('seed failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
