/**
 * Real behavior tests for the NATIVE secure-store BRIDGE path of the wallet
 * persistence layer (storage.ts).
 *
 * The companion storage.test.ts forces the WEB-FALLBACK path (device key in
 * localStorage). This file exercises the OTHER branch: when a React Native
 * WebView bridge is present, the device key is round-tripped through the OS
 * keystore via postMessage while ONLY the ciphertext blob stays in
 * localStorage.
 *
 * What is stubbed vs. what is real:
 *  - `getIsNative` is forced true and a fake `window.ReactNativeWebView`
 *    postMessage is installed — this is the DEVICE BOUNDARY, not logic under
 *    test. Our fake shell captures each request, then replies exactly like the
 *    real native side does: dispatching a `secureStoreResult` CustomEvent on
 *    `window` carrying { id, value }.
 *  - The actual code under test (hasNativeSecureStore, the request/response
 *    correlation by id, the set/get/delete routing, the timeout, and the
 *    SEPARATE-STORE invariant — key NEVER in localStorage) runs for real.
 */

// Force the NATIVE path for this file.
jest.mock('web/lib/native/is-native', () => ({ getIsNative: () => true }))
// post-message is replaced per-test by installing a fake ReactNativeWebView on
// window; the module export itself is not exercised here (storage.ts calls the
// real postMessageToNative, which forwards to window.ReactNativeWebView).

import {
  hasNativeSecureStore,
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
    cipher: 'YmFzZTY0Y2lwaGVy',
    iv: '0123456789abcdef01234567',
    salt: '0123456789abcdef0123456789abcdef',
    iterations: 600_000,
  }
}

const DEVICE_KEY =
  'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90'

/**
 * A fake native shell: an in-memory keystore plus a postMessage handler that
 * replies on the next tick exactly like the RN native side (a
 * `secureStoreResult` CustomEvent). This is the device boundary — a stand-in
 * for the OS Keychain/Keystore, NOT for any storage.ts logic.
 */
interface FakeNative {
  keystore: Map<string, string>
  messages: Array<{ type: string; data: { id: string; key: string; value?: string } }>
  autoRespond: boolean
}

function installFakeNative(autoRespond = true): FakeNative {
  const fake: FakeNative = {
    keystore: new Map(),
    messages: [],
    autoRespond,
  }

  const dispatch = (id: string, value: string | null) => {
    const ev = new CustomEvent('secureStoreResult', {
      detail: { id, value },
    })
    window.dispatchEvent(ev)
  }
  ;(window as unknown as { ReactNativeWebView: { postMessage: (raw: string) => void } }).ReactNativeWebView =
    {
      postMessage: (raw: string) => {
        const msg = JSON.parse(raw) as {
          type: string
          data: { id: string; key: string; value?: string }
        }
        fake.messages.push(msg)
        if (!fake.autoRespond) return
        // Emulate the OS keystore behavior and reply on the next tick.
        setTimeout(() => {
          if (msg.type === 'secureStoreSet') {
            fake.keystore.set(msg.data.key, msg.data.value ?? '')
            dispatch(msg.data.id, null)
          } else if (msg.type === 'secureStoreGet') {
            dispatch(msg.data.id, fake.keystore.get(msg.data.key) ?? null)
          } else if (msg.type === 'secureStoreDelete') {
            fake.keystore.delete(msg.data.key)
            dispatch(msg.data.id, null)
          }
        }, 0)
      },
    }

  return fake
}

/**
 * jsdom is not available in this node env; the jest setup installs a minimal
 * window shim whose addEventListener/removeEventListener are no-ops. Upgrade it
 * to a real event target for this suite so the request/response correlation can
 * actually fire, and provide CustomEvent + a working timer.
 */
function upgradeWindowToEventTarget() {
  const listeners = new Map<string, Set<EventListener>>()
  const w = window as unknown as {
    addEventListener: (t: string, l: EventListener) => void
    removeEventListener: (t: string, l: EventListener) => void
    dispatchEvent: (e: Event) => boolean
  }
  w.addEventListener = (type: string, l: EventListener) => {
    if (!listeners.has(type)) listeners.set(type, new Set())
    listeners.get(type)!.add(l)
  }
  w.removeEventListener = (type: string, l: EventListener) => {
    listeners.get(type)?.delete(l)
  }
  w.dispatchEvent = (e: Event) => {
    listeners.get(e.type)?.forEach((l) => l(e))
    return true
  }
}

// Minimal CustomEvent for the node env (no DOM).
class NodeCustomEvent<T> {
  type: string
  detail: T
  constructor(type: string, init: { detail: T }) {
    this.type = type
    this.detail = init.detail
  }
}

beforeAll(() => {
  ;(globalThis as unknown as { CustomEvent: unknown }).CustomEvent =
    NodeCustomEvent as unknown
  upgradeWindowToEventTarget()
})

beforeEach(() => {
  localStorage.clear()
  delete (window as unknown as { ReactNativeWebView?: unknown }).ReactNativeWebView
})

describe('native bridge: presence detection', () => {
  it('hasNativeSecureStore is false without a ReactNativeWebView bridge', () => {
    expect(hasNativeSecureStore()).toBe(false)
  })

  it('hasNativeSecureStore is true with a live postMessage bridge', () => {
    installFakeNative()
    expect(hasNativeSecureStore()).toBe(true)
  })

  it('hasNativeSecureStore is false if postMessage is not a function (OOM case)', () => {
    ;(window as unknown as { ReactNativeWebView: unknown }).ReactNativeWebView = {
      postMessage: undefined,
    }
    expect(hasNativeSecureStore()).toBe(false)
  })
})

describe('native bridge: device-key round-trip through the keystore', () => {
  it('persists key to the native keystore (NOT localStorage) and loads it back', async () => {
    const fake = installFakeNative()
    const ct = sampleCiphertext()

    await persistWallet(ct, DEVICE_KEY)

    // The device key went to the native keystore via a postMessage set.
    expect(fake.keystore.get(DEVICE_KEY_KEY)).toBe(DEVICE_KEY)
    // SEPARATE-STORE INVARIANT: the key is NEVER in web localStorage on native.
    expect(localStorage.getItem(DEVICE_KEY_KEY)).toBeNull()
    // The ciphertext blob DOES stay in localStorage (safe at rest).
    expect(localStorage.getItem(CIPHERTEXT_KEY)).not.toBeNull()

    const loaded = await loadWallet()
    expect(loaded).not.toBeNull()
    expect(loaded!.ciphertext).toEqual(ct)
    expect(loaded!.deviceKey).toBe(DEVICE_KEY)
  })

  it('emits secureStoreSet then secureStoreGet with correlated ids', async () => {
    const fake = installFakeNative()
    await persistWallet(sampleCiphertext(), DEVICE_KEY)
    await loadWallet()

    const types = fake.messages.map((m) => m.type)
    expect(types).toContain('secureStoreSet')
    expect(types).toContain('secureStoreGet')
    // Every request carries a non-empty correlation id.
    for (const m of fake.messages) {
      expect(typeof m.data.id).toBe('string')
      expect(m.data.id.length).toBeGreaterThan(0)
    }
  })

  it('wipe deletes from the native keystore and removes the local ciphertext', async () => {
    const fake = installFakeNative()
    await persistWallet(sampleCiphertext(), DEVICE_KEY)
    expect(fake.keystore.has(DEVICE_KEY_KEY)).toBe(true)

    await wipeWallet()

    expect(fake.keystore.has(DEVICE_KEY_KEY)).toBe(false)
    expect(localStorage.getItem(CIPHERTEXT_KEY)).toBeNull()
    expect(fake.messages.some((m) => m.type === 'secureStoreDelete')).toBe(true)
  })

  it('loadWallet returns null when the keystore lacks the key (blob only)', async () => {
    const fake = installFakeNative()
    await persistWallet(sampleCiphertext(), DEVICE_KEY)
    // Simulate the OS keystore losing the key while the blob survives.
    fake.keystore.delete(DEVICE_KEY_KEY)

    expect(hasStoredWallet()).toBe(true) // blob still present
    expect(await loadWallet()).toBeNull() // unusable without the key
  })
})

describe('native bridge: timeout when the shell never replies', () => {
  it('rejects a get when the native side is silent', async () => {
    // A blob must exist so getDeviceKey is actually reached inside loadWallet.
    installFakeNative(false)
    localStorage.setItem(CIPHERTEXT_KEY, JSON.stringify(sampleCiphertext()))

    jest.useFakeTimers()
    const pending = loadWallet()
    // Advance past the 8s native timeout.
    jest.advanceTimersByTime(8001)
    await expect(pending).rejects.toThrow('Native secure store did not respond.')
    jest.useRealTimers()
  })
})
