/**
 * Real behavior tests for settlement routing (on-chain vs the off-chain
 * play-money default). Exercises the REAL `settlementOf` decision tree, the
 * conditionId/questionId extractors, and — critically — the OFF-CHAIN-DEFAULT
 * invariant: when the deployment isn't configured, every market stays off-chain.
 *
 * The on-chain env addresses are set/cleared around the tests that need them
 * (getOnchainAddresses reads process.env lazily), so both configured and
 * unconfigured deployments are covered for real.
 */
import {
  conditionIdOf,
  isOnchainMarket,
  questionIdOf,
  settlementOf,
  ONCHAIN_GROUP_SLUGS,
  type SettlementReadable,
} from './settlement'
import { registerOnchainMarket } from './registry'

const A = '0x1111111111111111111111111111111111111111'
const VALID_CONDITION_ID =
  '0x' + 'ab'.repeat(32) // 66 chars, valid hex bytes32
const VALID_QUESTION_ID = '0x' + 'cd'.repeat(32)

const ONCHAIN_ENV = {
  NEXT_PUBLIC_ONCHAIN_UMA_ADAPTER: A,
  NEXT_PUBLIC_ONCHAIN_EXCHANGE: A,
  NEXT_PUBLIC_ONCHAIN_CONDITIONAL_TOKENS: A,
  NEXT_PUBLIC_ONCHAIN_UMA_OPTIMISTIC_ORACLE: A,
}

function enableOnchain() {
  for (const [k, v] of Object.entries(ONCHAIN_ENV)) process.env[k] = v
}
function disableOnchain() {
  for (const k of Object.keys(ONCHAIN_ENV)) delete process.env[k]
}

afterEach(() => {
  disableOnchain()
  localStorage.clear()
})

describe('settlementOf: OFF-CHAIN default (deployment not configured)', () => {
  it('is offchain even for an on-chain-tagged market when disabled', () => {
    disableOnchain()
    const m: SettlementReadable = {
      settlement: 'onchain',
      onchainConditionId: VALID_CONDITION_ID,
      groupSlugs: ['crypto'],
    }
    expect(settlementOf(m)).toBe('offchain')
    expect(isOnchainMarket(m)).toBe(false)
  })
})

describe('settlementOf: with the deployment configured', () => {
  beforeEach(enableOnchain)

  it('defaults a plain market to offchain', () => {
    expect(settlementOf({ id: 'm1' })).toBe('offchain')
  })

  it('honors an explicit onchain settlement flag', () => {
    expect(settlementOf({ settlement: 'onchain' })).toBe('onchain')
  })

  it('honors an explicit offchain flag over other on-chain signals', () => {
    expect(
      settlementOf({
        settlement: 'offchain',
        onchainConditionId: VALID_CONDITION_ID,
      })
    ).toBe('offchain')
  })

  it('treats a valid onchainConditionId as on-chain', () => {
    expect(settlementOf({ onchainConditionId: VALID_CONDITION_ID })).toBe(
      'onchain'
    )
  })

  it('ignores a malformed conditionId (wrong length / not hex)', () => {
    expect(settlementOf({ onchainConditionId: '0xdead' })).toBe('offchain')
    expect(settlementOf({ onchainConditionId: 'not-hex' })).toBe('offchain')
    expect(settlementOf({ onchainConditionId: undefined })).toBe('offchain')
  })

  it('treats crypto/usdc/onchain group membership as on-chain', () => {
    for (const slug of ONCHAIN_GROUP_SLUGS) {
      expect(settlementOf({ groupSlugs: [slug] })).toBe('onchain')
      // Case-insensitive.
      expect(settlementOf({ groupSlugs: [slug.toUpperCase()] })).toBe('onchain')
    }
  })

  it('is offchain for an unrelated group', () => {
    expect(settlementOf({ groupSlugs: ['politics', 'sports'] })).toBe(
      'offchain'
    )
    expect(settlementOf({ groupSlugs: [] })).toBe('offchain')
    expect(settlementOf({ groupSlugs: undefined })).toBe('offchain')
  })
})

describe('settlementOf: local registry deployment lookup', () => {
  // Exercises the `getOnchainDeployment(contract.id)` branch by SEEDING the real
  // registry (localStorage-backed) — no market tag / group, so on-chain status
  // is decided purely by the registry entry. Registry is cleared in afterEach.
  beforeEach(enableOnchain)

  it('treats a market with a registry deployment as on-chain', () => {
    registerOnchainMarket('m-reg', {
      conditionId: VALID_CONDITION_ID as `0x${string}`,
      questionId: VALID_QUESTION_ID as `0x${string}`,
    })
    // No onchainConditionId tag, no group — only the registry drives this.
    const m: SettlementReadable = { id: 'm-reg' }
    expect(settlementOf(m)).toBe('onchain')
    expect(isOnchainMarket(m)).toBe(true)
  })

  it('is offchain when the id has no registry entry', () => {
    registerOnchainMarket('other-market', {
      conditionId: VALID_CONDITION_ID as `0x${string}`,
      questionId: VALID_QUESTION_ID as `0x${string}`,
    })
    expect(settlementOf({ id: 'm-missing' })).toBe('offchain')
  })

  it('an explicit offchain flag still overrides a registry deployment', () => {
    registerOnchainMarket('m-reg2', {
      conditionId: VALID_CONDITION_ID as `0x${string}`,
      questionId: VALID_QUESTION_ID as `0x${string}`,
    })
    expect(settlementOf({ id: 'm-reg2', settlement: 'offchain' })).toBe(
      'offchain'
    )
  })

  it('stays offchain via the registry branch when the deployment is disabled', () => {
    // Even with a seeded registry entry, a misconfigured (disabled) deployment
    // short-circuits to offchain before the registry is consulted.
    disableOnchain()
    registerOnchainMarket('m-reg3', {
      conditionId: VALID_CONDITION_ID as `0x${string}`,
      questionId: VALID_QUESTION_ID as `0x${string}`,
    })
    expect(settlementOf({ id: 'm-reg3' })).toBe('offchain')
  })
})

describe('conditionIdOf / questionIdOf', () => {
  it('returns the conditionId when the tag is a valid bytes32', () => {
    expect(conditionIdOf({ onchainConditionId: VALID_CONDITION_ID })).toBe(
      VALID_CONDITION_ID
    )
  })

  it('returns null for a missing / malformed conditionId', () => {
    expect(conditionIdOf({})).toBeNull()
    expect(conditionIdOf({ onchainConditionId: '0xshort' })).toBeNull()
  })

  it('falls back to the registry conditionId when there is no tag', () => {
    registerOnchainMarket('m-fallback', {
      conditionId: VALID_CONDITION_ID as `0x${string}`,
      questionId: VALID_QUESTION_ID as `0x${string}`,
    })
    // No onchainConditionId tag: the registry supplies the handle.
    expect(conditionIdOf({ id: 'm-fallback' })).toBe(VALID_CONDITION_ID)
    // Unknown id -> still null.
    expect(conditionIdOf({ id: 'nope' })).toBeNull()
  })

  it('prefers a valid tag over the registry entry', () => {
    const tagId = ('0x' + 'ef'.repeat(32)) as `0x${string}`
    registerOnchainMarket('m-both', {
      conditionId: VALID_CONDITION_ID as `0x${string}`,
      questionId: VALID_QUESTION_ID as `0x${string}`,
    })
    expect(
      conditionIdOf({ id: 'm-both', onchainConditionId: tagId })
    ).toBe(tagId)
  })

  it('returns the questionId only for a valid 64-hex-char value', () => {
    expect(questionIdOf({ onchainQuestionId: VALID_QUESTION_ID })).toBe(
      VALID_QUESTION_ID
    )
    expect(questionIdOf({ onchainQuestionId: '0x123' })).toBeNull()
    expect(questionIdOf({})).toBeNull()
  })

  it('falls back to the registry questionId when there is no tag', () => {
    registerOnchainMarket('m-q', {
      conditionId: VALID_CONDITION_ID as `0x${string}`,
      questionId: VALID_QUESTION_ID as `0x${string}`,
    })
    expect(questionIdOf({ id: 'm-q' })).toBe(VALID_QUESTION_ID)
    expect(questionIdOf({ id: 'unknown' })).toBeNull()
  })
})
