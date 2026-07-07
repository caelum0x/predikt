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

describe('usdcAddress', () => {
  it('returns the canonical native USDC per chain', () => {
    expect(usdcAddress('polygon')).toBe(EVM_CHAINS.polygon.usdc)
    expect(usdcAddress('ethereum')).toBe(EVM_CHAINS.ethereum.usdc)
  })
})
