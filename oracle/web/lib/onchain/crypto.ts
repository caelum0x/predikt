/**
 * At-rest encryption primitives for the wallet mnemonic — WEB port.
 *
 * Ported from the native wallet's `cryptoUtils.ts` SECURITY PATTERN, but
 * implemented entirely with the browser's WebCrypto `SubtleCrypto` — no heavy
 * dependency (no crypto-es / node crypto). AES-256-GCM for confidentiality +
 * integrity, PBKDF2-HMAC-SHA256 for key stretching.
 *
 * SECURITY: the encryption key is NEVER returned alongside the ciphertext. The
 * caller passes in a `key` that lives in a *separate* store (a native
 * secure-store entry via the bridge, or a localStorage slot kept apart from the
 * ciphertext blob — see `storage.ts`). An attacker who reads the encrypted blob
 * cannot also read the key from the same place.
 */

/**
 * PBKDF2 work factor for at-rest secret encryption.
 *
 * Matches the native wallet floor (NIST SP 800-132 (2023) recommended minimum
 * for PBKDF2-HMAC-SHA256 protecting secrets at rest). Derivation happens once
 * at wallet create/import and once per unlock, so the latency is acceptable.
 */
export const PBKDF2_MIN_ITERATIONS = 600_000

export const PBKDF2_ITERATIONS = PBKDF2_MIN_ITERATIONS

/** Serialized encrypted blob. Layout mirrors the native `EncryptedData`. */
export interface EncryptedData {
  /** Base64 AES-256-GCM ciphertext (auth tag appended by WebCrypto). */
  cipher: string
  /** Hex 12-byte GCM initialization vector. */
  iv: string
  /** Hex 16-byte PBKDF2 salt. */
  salt: string
  /** PBKDF2 iteration count used to derive the key. */
  iterations: number
}

const AES_KEY_BITS = 256
const GCM_IV_BYTES = 12
const SALT_BYTES = 16
const DEVICE_KEY_BYTES = 32

function getSubtle(): SubtleCrypto {
  const c =
    typeof globalThis !== 'undefined'
      ? (globalThis.crypto as Crypto | undefined)
      : undefined
  if (!c || !c.subtle) {
    throw new Error('WebCrypto SubtleCrypto is unavailable in this environment.')
  }
  return c.subtle
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  globalThis.crypto.getRandomValues(bytes)
  return bytes
}

function toHex(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('Invalid hex string.')
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

/** Buffer-source view over a plain Uint8Array (satisfies WebCrypto types). */
function buf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer
}

/**
 * Generate a 256-bit random key as a hex string (used as the device key). The
 * caller stores this SEPARATELY from any ciphertext it protects.
 */
export async function generateKey(): Promise<string> {
  return toHex(randomBytes(DEVICE_KEY_BYTES))
}

/** Derive an AES-256-GCM key from `key` + `salt` via PBKDF2-HMAC-SHA256. */
async function deriveAesKey(
  key: string,
  salt: Uint8Array,
  iterations: number
): Promise<CryptoKey> {
  const subtle = getSubtle()
  const baseKey = await subtle.importKey(
    'raw',
    buf(new TextEncoder().encode(key)),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  )
  return subtle.deriveKey(
    { name: 'PBKDF2', salt: buf(salt), iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: AES_KEY_BITS },
    false,
    ['encrypt', 'decrypt']
  )
}

export async function encryptData(
  text: string,
  key: string
): Promise<EncryptedData> {
  const subtle = getSubtle()
  const salt = randomBytes(SALT_BYTES)
  const iv = randomBytes(GCM_IV_BYTES)
  const iterations = PBKDF2_ITERATIONS

  const aesKey = await deriveAesKey(key, salt, iterations)
  const cipherBuf = await subtle.encrypt(
    { name: 'AES-GCM', iv: buf(iv) },
    aesKey,
    buf(new TextEncoder().encode(text))
  )

  return {
    cipher: toBase64(new Uint8Array(cipherBuf)),
    iv: toHex(iv),
    salt: toHex(salt),
    iterations,
  }
}

export async function decryptData(
  encryptedData: EncryptedData,
  key: string
): Promise<string> {
  const subtle = getSubtle()
  const { cipher, iv, salt, iterations } = encryptedData

  const aesKey = await deriveAesKey(key, fromHex(salt), iterations)
  const plainBuf = await subtle.decrypt(
    { name: 'AES-GCM', iv: buf(fromHex(iv)) },
    aesKey,
    buf(fromBase64(cipher))
  )

  return new TextDecoder().decode(plainBuf)
}

/**
 * Encrypt `value` under a caller-supplied `key`. The key is intentionally NOT
 * embedded in the returned struct — the caller stores it separately.
 */
export async function encryptDataWithKey(
  value: string,
  key: string
): Promise<EncryptedData> {
  try {
    return await encryptData(value, key)
  } catch {
    // SECURITY: never log the caught error — it can reference secret material.
    throw new Error('Failed to encrypt data securely.')
  }
}

export async function decryptDataWithKey(
  encryptedData: EncryptedData,
  key: string
): Promise<string> {
  try {
    return await decryptData(encryptedData, key)
  } catch {
    // SECURITY: never log the caught error — it can reference secret material.
    throw new Error('Failed to decrypt data.')
  }
}
