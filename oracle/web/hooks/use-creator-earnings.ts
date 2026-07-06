import { useEffect, useState } from 'react'
import { Txn, UniqueBettorBonusTxn } from 'common/txn'
import { useEvent } from 'client-common/hooks/use-event'
import { api } from 'web/lib/api/api'

// The real, ledger-backed creator incentive on this platform is the unique
// trader bonus: every time a NEW trader bets on a market you created, the bank
// pays you mana (see getUniqueBettorBonusAmount / UNIQUE_BETTOR_BONUS txns).
// There is no percentage "creator fee" — the fee model routes all trade fees to
// the platform (common/src/fees.ts sets creatorFee: 0) — so trader bonuses are
// the genuine earnings we surface here. Nothing is estimated or fabricated:
// every figure below is summed from real txns paid to this user.

export type CreatorEarnings = {
  // Total mana earned from unique-trader bonuses across all of this user's
  // markets (all tokens normalized to mana; only M$ bonuses are paid).
  totalMana: number
  // Per-contract earnings, keyed by contractId.
  byContract: Record<string, number>
  // Number of bonus payments received (roughly, distinct new-trader awards).
  awardCount: number
}

const PAGE_LIMIT = 100

// Paginate the real UNIQUE_BETTOR_BONUS ledger for this creator and total it up.
async function fetchCreatorEarnings(
  userId: string
): Promise<CreatorEarnings> {
  const byContract: Record<string, number> = {}
  let totalMana = 0
  let awardCount = 0
  let before: number | undefined = undefined

  // The txns endpoint caps limit at 100, so page backwards through time using
  // the createdTime of the last item until a short page signals the end.
  // Guard with a hard page cap so a pathological account can't loop forever.
  const MAX_PAGES = 200
  for (let page = 0; page < MAX_PAGES; page++) {
    const txns: Txn[] = await api('txns', {
      category: 'UNIQUE_BETTOR_BONUS',
      toId: userId,
      limit: PAGE_LIMIT,
      before,
    })

    if (txns.length === 0) break

    // The endpoint returns the broad Txn union; narrow to the bonus shape by the
    // category we filtered on so txn.data.contractId is typed correctly.
    const bonuses = txns.filter(
      (txn): txn is UniqueBettorBonusTxn =>
        txn.category === 'UNIQUE_BETTOR_BONUS'
    )

    for (const txn of bonuses) {
      // Only mana bonuses exist for this category, but stay defensive.
      if (txn.token !== 'M$') continue
      totalMana += txn.amount
      awardCount += 1
      const contractId = txn.data?.contractId
      if (contractId) {
        byContract[contractId] = (byContract[contractId] ?? 0) + txn.amount
      }
    }

    if (txns.length < PAGE_LIMIT) break
    before = txns[txns.length - 1].createdTime
  }

  return { totalMana, byContract, awardCount }
}

// Real trader-bonus mana this creator has earned from a single market.
// Paginates UNIQUE_BETTOR_BONUS txns paid to the creator and keeps only those
// tagged with this contractId. Undefined while loading.
export function useContractCreatorEarnings(
  userId: string | undefined,
  contractId: string | undefined
): number | undefined {
  const [earned, setEarned] = useState<number | undefined>(undefined)

  const load = useEvent(async () => {
    if (!userId || !contractId) return
    try {
      const { byContract } = await fetchCreatorEarnings(userId)
      setEarned(byContract[contractId] ?? 0)
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Unknown error'
      console.error('Failed to load contract creator earnings:', message)
    }
  })

  useEffect(() => {
    setEarned(undefined)
    load()
  }, [userId, contractId])

  return earned
}

// Returns the creator's real trader-bonus earnings, or undefined while loading.
export function useCreatorEarnings(
  userId: string | undefined
): CreatorEarnings | undefined {
  const [earnings, setEarnings] = useState<CreatorEarnings | undefined>(
    undefined
  )

  const load = useEvent(async () => {
    if (!userId) return
    try {
      const result = await fetchCreatorEarnings(userId)
      setEarnings(result)
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Unknown error'
      console.error('Failed to load creator earnings:', message)
      // Leave earnings undefined so the UI can fall back gracefully rather than
      // showing a fabricated zero.
    }
  })

  useEffect(() => {
    setEarnings(undefined)
    load()
  }, [userId])

  return earnings
}
