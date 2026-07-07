/**
 * Real behavior tests for wallet at-rest persistence.
 *
 * The native secure-store BRIDGE is a device boundary (React Native WebView
 * postMessage), not part of the logic under test, so it is stubbed to force the
 * WEB-FALLBACK path — the actual code under test (persist / load / wipe / blob
 * validation, and the SEPARATE-STORE security invariant) runs for real against
 * the in-memory localStorage from the jest setup.
 */

// Force the non-native path: no RN WebView bridge in this environment.
jest.mock('web/lib/native/is-native', () => ({ getIsNative: () => false }))
jest.mock('web/lib/native/post-message', () => ({
  postMessageToNative: () => undefined,
}))

import {
  hasStoredWallet,
  loadWallet,
  persistWallet,
  wipeWallet,
} from './storage'
import type { EncryptedData } from './crypto'

const CIPHERTEXT_KEY = 'predikt.wallet.mnemonic.enc'
const DEVICE_KEY_KEY = 'predikt.wallet.deviceKey'

function sampleCiphertext(): EncryptedData {
  return {
    cipher: 'YmFzZTY0Y2lwaGVy', // "base64cipher"
    iv: '0123456789abcdef01234567',
    salt: '0123456789abcdef0123456789abcdef',
    iterations: 600_000,
  }
}

const DEVICE_KEY =
  'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90'

beforeEach(() => {
  localStorage.clear()
})

describe('storage: persist + load round-trip (web fallback)', () => {
  it('starts with no stored wallet', () => {
    expect(hasStoredWallet()).toBe(false)
    // loadWallet is async and returns null when nothing is stored.
    return expect(loadWallet()).resolves.toBeNull()
  })

  it('persists both halves and loads them back intact', async () => {
    const ct = sampleCiphertext()
    await persistWallet(ct, DEVICE_KEY)
    expect(hasStoredWallet()).toBe(true)
    const loaded = await loadWallet()
    expect(loaded).not.toBeNull()
    expect(loaded!.ciphertext).toEqual(ct)
    expect(loaded!.deviceKey).toBe(DEVICE_KEY)
  })

  it('wipes both halves', async () => {
    await persistWallet(sampleCiphertext(), DEVICE_KEY)
    await wipeWallet()
    expect(hasStoredWallet()).toBe(false)
    expect(await loadWallet()).toBeNull()
    expect(localStorage.getItem(CIPHERTEXT_KEY)).toBeNull()
    expect(localStorage.getItem(DEVICE_KEY_KEY)).toBeNull()
  })
})

describe('storage: SEPARATE-STORE security invariant', () => {
  it('key and ciphertext live in DIFFERENT localStorage slots', async () => {
    await persistWallet(sampleCiphertext(), DEVICE_KEY)
    const cipherSlot = localStorage.getItem(CIPHERTEXT_KEY)
    const keySlot = localStorage.getItem(DEVICE_KEY_KEY)
    expect(cipherSlot).not.toBeNull()
    expect(keySlot).toBe(DEVICE_KEY)
    // The slots are distinct names — never co-located.
    expect(CIPHERTEXT_KEY).not.toBe(DEVICE_KEY_KEY)
  })

  it('the device key is NEVER present inside the ciphertext blob', async () => {
    await persistWallet(sampleCiphertext(), DEVICE_KEY)
    const cipherSlot = localStorage.getItem(CIPHERTEXT_KEY)!
    expect(cipherSlot.includes(DEVICE_KEY)).toBe(false)
  })

  it('loading fails (null) if ONLY the ciphertext survives (key wiped)', async () => {
    await persistWallet(sampleCiphertext(), DEVICE_KEY)
    localStorage.removeItem(DEVICE_KEY_KEY)
    expect(hasStoredWallet()).toBe(true) // blob still there
    expect(await loadWallet()).toBeNull() // but unusable without the key
  })

  it('loading fails (null) if ONLY the key survives (ciphertext wiped)', async () => {
    await persistWallet(sampleCiphertext(), DEVICE_KEY)
    localStorage.removeItem(CIPHERTEXT_KEY)
    expect(hasStoredWallet()).toBe(false)
    expect(await loadWallet()).toBeNull()
  })
})

describe('storage: ciphertext blob validation', () => {
  it('rejects a malformed/partial blob (missing fields)', async () => {
    localStorage.setItem(
      CIPHERTEXT_KEY,
      JSON.stringify({ cipher: 'x', iv: 'y' }) // no salt/iterations
    )
    localStorage.setItem(DEVICE_KEY_KEY, DEVICE_KEY)
    expect(hasStoredWallet()).toBe(false)
    expect(await loadWallet()).toBeNull()
  })

  it('rejects a non-JSON blob without throwing', async () => {
    localStorage.setItem(CIPHERTEXT_KEY, 'not-json{')
    localStorage.setItem(DEVICE_KEY_KEY, DEVICE_KEY)
    expect(hasStoredWallet()).toBe(false)
    expect(await loadWallet()).toBeNull()
  })

  it('rejects a blob whose iterations is not a number', async () => {
    localStorage.setItem(
      CIPHERTEXT_KEY,
      JSON.stringify({
        cipher: 'x',
        iv: 'y',
        salt: 'z',
        iterations: '600000', // string, not number
      })
    )
    expect(hasStoredWallet()).toBe(false)
  })
})
