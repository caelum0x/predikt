/**
 * Real behavior tests for the EVM chain registry. Pure config + lookups +
 * RPC-URL resolution (env override vs public default). No network.
 */
import {
  CHAIN_ORDER,
  EVM_CHAINS,
  PRIMARY_CHAIN_KEY,
  getChainConfig,
  getChainConfigById,
  resolveRpcHttp,
  usdcAddress,
  type ChainKey,
} from './chains'

describe('chain registry integrity', () => {
  it('polygon is PRIMARY (where markets + USDC settle)', () => {
    expect(PRIMARY_CHAIN_KEY).toBe('polygon')
    expect(EVM_CHAINS.polygon.chainId).toBe(137)
  })

  it('CHAIN_ORDER lists primary first and covers every chain exactly once', () => {
    expect(CHAIN_ORDER[0]).toBe('polygon')
    const keys = Object.keys(EVM_CHAINS) as ChainKey[]
    expect(new Set(CHAIN_ORDER)).toEqual(new Set(keys))
    expect(CHAIN_ORDER.length).toBe(keys.length)
  })

  it('every chain config is internally consistent', () => {
    for (const key of Object.keys(EVM_CHAINS) as ChainKey[]) {
      const c = EVM_CHAINS[key]
      expect(c.key).toBe(key)
      expect(c.viemChain.id).toBe(c.chainId)
      expect(c.usdc).toMatch(/^0x[0-9a-fA-F]{40}$/)
      expect(c.publicRpcHttp).toMatch(/^https:\/\//)
      expect(c.rpcEnvVar.startsWith('NEXT_PUBLIC_RPC_')).toBe(true)
    }
  })

  it('every chainId is unique', () => {
    const ids = Object.values(EVM_CHAINS).map((c) => c.chainId)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('getChainConfig / getChainConfigById', () => {
  it('resolves a known chain by key', () => {
    expect(getChainConfig('base').chainId).toBe(8453)
  })

  it('throws for an unknown key', () => {
    expect(() => getChainConfig('dogecoin' as ChainKey)).toThrow(
      'Unknown chain: dogecoin'
    )
  })

  it('resolves a known chain by id, undefined otherwise', () => {
    expect(getChainConfigById(137)?.key).toBe('polygon')
    expect(getChainConfigById(999999)).toBeUndefined()
  })
})

describe('resolveRpcHttp: env override vs public default', () => {
  const KEY = 'NEXT_PUBLIC_RPC_POLYGON'
  const original = process.env[KEY]
  afterEach(() => {
    if (original === undefined) delete process.env[KEY]
    else process.env[KEY] = original
  })

  it('uses the free public endpoint when no override is set', () => {
    delete process.env[KEY]
    expect(resolveRpcHttp('polygon')).toBe(EVM_CHAINS.polygon.publicRpcHttp)
  })

  it('prefers a non-empty env override', () => {
    process.env[KEY] = 'https://my-private-rpc.example/polygon'
    expect(resolveRpcHttp('polygon')).toBe(
      'https://my-private-rpc.example/polygon'
    )
  })

  it('ignores an empty override and falls back to public', () => {
    process.env[KEY] = ''
    expect(resolveRpcHttp('polygon')).toBe(EVM_CHAINS.polygon.publicRpcHttp)
  })
})

describe('getChainConfig / getChainConfigById (edge cases)', () => {
  it('resolves every declared chain by its own key', () => {
    for (const key of CHAIN_ORDER) {
      expect(getChainConfig(key).key).toBe(key)
    }
  })

  it('round-trips key -> id -> config for every chain', () => {
    for (const key of CHAIN_ORDER) {
      const byKey = getChainConfig(key)
      const byId = getChainConfigById(byKey.chainId)
      expect(byId).toBeDefined()
      expect(byId!.key).toBe(key)
    }
  })

  it('returns undefined for boundary/negative/zero ids', () => {
    expect(getChainConfigById(0)).toBeUndefined()
    expect(getChainConfigById(-1)).toBeUndefined()
    expect(getChainConfigById(Number.MAX_SAFE_INTEGER)).toBeUndefined()
    // 138 is adjacent to Polygon's 137 but is not a registered chain.
    expect(getChainConfigById(138)).toBeUndefined()
  })

  it('throws with the offending key for empty-string and non-chain keys', () => {
    expect(() => getChainConfig('' as ChainKey)).toThrow('Unknown chain: ')
    expect(() => getChainConfig('POLYGON' as ChainKey)).toThrow(
      'Unknown chain: POLYGON'
    )
  })
})

describe('resolveRpcHttp: exhaustive per-chain env override handling', () => {
  const ENV_KEYS = CHAIN_ORDER.map((k) => EVM_CHAINS[k].rpcEnvVar)
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key]
      delete process.env[key]
    }
  })
  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
  })

  it('falls back to the public endpoint for EVERY chain when unset', () => {
    for (const key of CHAIN_ORDER) {
      expect(resolveRpcHttp(key)).toBe(EVM_CHAINS[key].publicRpcHttp)
    }
  })

  it('honors a distinct override for EVERY chain independently', () => {
    for (const key of CHAIN_ORDER) {
      const url = `https://override.example/${key}`
      process.env[EVM_CHAINS[key].rpcEnvVar] = url
      expect(resolveRpcHttp(key)).toBe(url)
    }
    // Overrides do not bleed across chains: each resolves to its own url.
    for (const key of CHAIN_ORDER) {
      expect(resolveRpcHttp(key)).toBe(`https://override.example/${key}`)
    }
  })

  it('treats an empty-string override as unset (public fallback) per chain', () => {
    for (const key of CHAIN_ORDER) {
      process.env[EVM_CHAINS[key].rpcEnvVar] = ''
      expect(resolveRpcHttp(key)).toBe(EVM_CHAINS[key].publicRpcHttp)
    }
  })

  it('propagates the unknown-chain throw from getChainConfig', () => {
    expect(() => resolveRpcHttp('litecoin' as ChainKey)).toThrow(
      'Unknown chain: litecoin'
    )
  })
})

describe('usdcAddress', () => {
  it('returns the canonical native USDC per chain', () => {
    expect(usdcAddress('polygon')).toBe(EVM_CHAINS.polygon.usdc)
    expect(usdcAddress('ethereum')).toBe(EVM_CHAINS.ethereum.usdc)
  })

  it('returns a well-formed USDC address for EVERY chain', () => {
    for (const key of CHAIN_ORDER) {
      expect(usdcAddress(key)).toBe(EVM_CHAINS[key].usdc)
      expect(usdcAddress(key)).toMatch(/^0x[0-9a-fA-F]{40}$/)
    }
  })

  it('propagates the unknown-chain throw', () => {
    expect(() => usdcAddress('solana' as ChainKey)).toThrow(
      'Unknown chain: solana'
    )
  })
})
