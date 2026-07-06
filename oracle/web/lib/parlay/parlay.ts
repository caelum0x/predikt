// Client-side PARLAY (combo) support.
//
// Predikt has no on-chain parlay primitive, so a parlay here is a lightweight,
// shareable bundle of 2–4 existing markets. We combine the REAL implied odds of
// each leg (assuming independence) into a single "all legs hit" probability.
// The bundle is encoded into a deep link so anyone can open the same parlay and
// see the live legs. Nothing new is created on-chain or off-chain — it is a view
// over real markets.

export const MIN_PARLAY_LEGS = 2
export const MAX_PARLAY_LEGS = 4

// A single leg: a market plus which side of it the parlay is betting on.
export type ParlaySide = 'YES' | 'NO'

export type ParlayLeg = {
  contractId: string
  side: ParlaySide
}

// A leg resolved against live market data, ready to display.
export type ResolvedParlayLeg = {
  contractId: string
  side: ParlaySide
  question: string
  url: string
  // Implied probability (0–1) that this leg hits, given the chosen side.
  legProbability: number
}

// Clamp a probability into a sane open interval so a single 0%/100% leg doesn't
// make the whole parlay trivially 0 or 1 and to avoid divide-by-zero downstream.
function clampProb(p: number): number {
  if (!Number.isFinite(p)) return 0.5
  return Math.min(0.999, Math.max(0.001, p))
}

// Probability that a chosen side hits, from a market's YES probability.
export function sideProbability(yesProbability: number, side: ParlaySide): number {
  const yes = clampProb(yesProbability)
  return side === 'YES' ? yes : 1 - yes
}

// Combined probability that ALL legs hit, assuming independence.
export function combinedParlayProbability(
  legProbabilities: number[]
): number {
  if (legProbabilities.length === 0) return 0
  return legProbabilities.reduce((acc, p) => acc * clampProb(p), 1)
}

// Decimal payout multiplier implied by a probability (1 / p). A 25% parlay pays
// ~4x. Purely informational — no real payout is promised.
export function impliedMultiplier(probability: number): number {
  const p = clampProb(probability)
  return 1 / p
}

// ----- Deep-link encoding -----
//
// Encoded as `id:side` pairs joined by "_", e.g. "abc:YES_def:NO". Compact,
// URL-safe, and human-inspectable. Order is preserved.

export function encodeParlayLegs(legs: ParlayLeg[]): string {
  return legs
    .filter((l) => l.contractId.length > 0)
    .slice(0, MAX_PARLAY_LEGS)
    .map((l) => `${l.contractId}:${l.side}`)
    .join('_')
}

export function decodeParlayLegs(encoded: string): ParlayLeg[] {
  if (!encoded) return []
  return encoded
    .split('_')
    .map((part) => {
      const [contractId, rawSide] = part.split(':')
      const side: ParlaySide = rawSide === 'NO' ? 'NO' : 'YES'
      return { contractId, side }
    })
    .filter((l) => !!l.contractId)
    .slice(0, MAX_PARLAY_LEGS)
}

// Build the relative shareable path for a parlay.
export function parlayPath(legs: ParlayLeg[]): string {
  return `/parlay/${encodeParlayLegs(legs)}`
}
