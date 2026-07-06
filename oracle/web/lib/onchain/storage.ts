/**
 * Persistence for the wallet's at-rest secrets.
 *
 * SECURITY INVARIANT (ported from the native wallet): the encrypted mnemonic
 * blob (ciphertext) and the device key that decrypts it live in SEPARATE
 * stores. An attacker who reads one must NOT be able to read the other from the
 * same place — the key is NEVER stored beside the ciphertext.
 *
 * Two backends, selected at runtime:
 *
 *  1. Native secure-store bridge (preferred when running inside the RN
 *     WebView). The device key is written to the OS keystore
 *     (Keychain / Keystore) via `postMessageToNative`, while the ciphertext
 *     blob stays in web localStorage. Hardware-backed key isolation.
 *
 *  2. Web-only fallback. The device key goes in localStorage under a
 *     dedicated, namespaced slot that is kept apart from the ciphertext blob's
 *     slot. Same "never key beside ciphertext" invariant, weaker isolation.
 */

import { getIsNative } from 'web/lib/native/is-native'
import { postMessageToNative } from 'web/lib/native/post-message'
import { safeLocalStorage } from 'web/lib/util/local'
import type { EncryptedData } from './crypto'

/** localStorage slot for the encrypted mnemonic blob (ciphertext only). */
const CIPHERTEXT_KEY = 'predikt.wallet.mnemonic.enc'
/**
 * localStorage slot for the device key in the WEB fallback. Deliberately a
 * different, clearly-separate slot from CIPHERTEXT_KEY — never co-located.
 */
const DEVICE_KEY_KEY = 'predikt.wallet.deviceKey'
/** Keystore entry name used on the native side of the bridge. */
const NATIVE_DEVICE_KEY_ENTRY = 'predikt.wallet.deviceKey'

function requireStore() {
  if (!safeLocalStorage) {
    throw new Error('Local storage is unavailable; cannot persist wallet.')
  }
  return safeLocalStorage
}

/**
 * Whether a native secure-store bridge is reachable. Requires both the
 * "is-native" flag and a live `ReactNativeWebView.postMessage`. When true the
 * device key is round-tripped through the OS keystore.
 */
export function hasNativeSecureStore(): boolean {
  if (!getIsNative()) return false
  if (typeof window === 'undefined') return false
  const rn = (window as unknown as { ReactNativeWebView?: { postMessage?: unknown } })
    .ReactNativeWebView
  return !!rn && typeof rn.postMessage === 'function'
}

// --------------------------------------------------------------------------
// Native secure-store bridge (device key only).
//
// The native shell listens for `secureStoreSet` / `secureStoreGet` /
// `secureStoreDelete` messages and replies on `window` via a
// `secureStoreResult` CustomEvent carrying { id, value }. We correlate
// request/response by a random id and time out so a missing native handler
// surfaces as a clear error rather than hanging.
// --------------------------------------------------------------------------

interface SecureStoreResult {
  id: string
  value: string | null
}

const NATIVE_TIMEOUT_MS = 8000

function nativeRequest(
  type: 'secureStoreSet' | 'secureStoreGet' | 'secureStoreDelete',
  payload: { key: string; value?: string }
): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const id =
      globalThis.crypto?.randomUUID?.() ??
      `${Date.now()}-${Math.random().toString(16).slice(2)}`

    let settled = false
    const cleanup = () => {
      window.removeEventListener('secureStoreResult', onResult as EventListener)
      clearTimeout(timer)
    }
    const onResult = (ev: Event) => {
      const detail = (ev as CustomEvent<SecureStoreResult>).detail
      if (!detail || detail.id !== id) return
      settled = true
      cleanup()
      resolve(detail.value ?? null)
    }
    const timer = setTimeout(() => {
      if (settled) return
      cleanup()
      reject(new Error('Native secure store did not respond.'))
    }, NATIVE_TIMEOUT_MS)

    window.addEventListener('secureStoreResult', onResult as EventListener)
    postMessageToNative(type as never, { id, ...payload })
  })
}

async function setDeviceKey(key: string): Promise<void> {
  if (hasNativeSecureStore()) {
    await nativeRequest('secureStoreSet', {
      key: NATIVE_DEVICE_KEY_ENTRY,
      value: key,
    })
    return
  }
  requireStore().setItem(DEVICE_KEY_KEY, key)
}

async function getDeviceKey(): Promise<string | null> {
  if (hasNativeSecureStore()) {
    return nativeRequest('secureStoreGet', { key: NATIVE_DEVICE_KEY_ENTRY })
  }
  return requireStore().getItem(DEVICE_KEY_KEY)
}

async function deleteDeviceKey(): Promise<void> {
  if (hasNativeSecureStore()) {
    await nativeRequest('secureStoreDelete', { key: NATIVE_DEVICE_KEY_ENTRY })
    return
  }
  requireStore().removeItem(DEVICE_KEY_KEY)
}

// --------------------------------------------------------------------------
// Ciphertext blob (web localStorage in both modes — it is safe at rest).
// --------------------------------------------------------------------------

function setCiphertext(data: EncryptedData): void {
  requireStore().setItem(CIPHERTEXT_KEY, JSON.stringify(data))
}

function getCiphertext(): EncryptedData | null {
  const raw = requireStore().getItem(CIPHERTEXT_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as EncryptedData
    if (
      typeof parsed.cipher !== 'string' ||
      typeof parsed.iv !== 'string' ||
      typeof parsed.salt !== 'string' ||
      typeof parsed.iterations !== 'number'
    ) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function deleteCiphertext(): void {
  requireStore().removeItem(CIPHERTEXT_KEY)
}

// --------------------------------------------------------------------------
// Public API — the wallet layer only ever touches these.
// --------------------------------------------------------------------------

/** Persist the device key (separate store) and the ciphertext blob. */
export async function persistWallet(
  ciphertext: EncryptedData,
  deviceKey: string
): Promise<void> {
  await setDeviceKey(deviceKey)
  setCiphertext(ciphertext)
}

/** Load both halves. Returns null when either half is missing. */
export async function loadWallet(): Promise<{
  ciphertext: EncryptedData
  deviceKey: string
} | null> {
  const ciphertext = getCiphertext()
  const deviceKey = await getDeviceKey()
  if (!ciphertext || !deviceKey) return null
  return { ciphertext, deviceKey }
}

/** True when an encrypted wallet blob exists on this device. */
export function hasStoredWallet(): boolean {
  return getCiphertext() !== null
}

/** Remove both the ciphertext blob and the device key. */
export async function wipeWallet(): Promise<void> {
  deleteCiphertext()
  await deleteDeviceKey()
}
