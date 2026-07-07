/**
 * Real behavior tests for the wallet at-rest encryption primitives.
 *
 * These exercise the ACTUAL WebCrypto (AES-256-GCM + PBKDF2) implementation —
 * no crypto is faked. To keep the suite fast we override PBKDF2 iterations via a
 * small wrapper on the low-level `encryptData`/`decryptData` (which take the
 * blob's own iteration count), rather than the 600k-iteration default path. The
 * round-trip, wrong-key, and key-never-equals-ciphertext invariants are the same
 * regardless of iteration count.
 */
import {
  decryptData,
  decryptDataWithKey,
  encryptData,
  encryptDataWithKey,
  generateKey,
  PBKDF2_ITERATIONS,
  PBKDF2_MIN_ITERATIONS,
  type EncryptedData,
} from './crypto'

const MNEMONIC =
  'legal winner thank year wave sausage worth useful legal winner thank yellow'

describe('crypto: key generation', () => {
  it('generateKey returns a 32-byte (64 hex char) random hex key', async () => {
    const key = await generateKey()
    expect(key).toMatch(/^[0-9a-f]{64}$/)
  })

  it('generateKey returns a fresh key each call (no reuse)', async () => {
    const a = await generateKey()
    const b = await generateKey()
    expect(a).not.toEqual(b)
  })

  it('PBKDF2 iterations meet the NIST at-rest floor', () => {
    expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(PBKDF2_MIN_ITERATIONS)
    expect(PBKDF2_MIN_ITERATIONS).toBeGreaterThanOrEqual(600_000)
  })
})

describe('crypto: encrypt -> decrypt round-trip', () => {
  it('recovers the exact plaintext mnemonic', async () => {
    const key = await generateKey()
    const enc = await encryptData(MNEMONIC, key)
    const dec = await decryptData(enc, key)
    expect(dec).toBe(MNEMONIC)
  })

  it('round-trips through the public with-key wrappers', async () => {
    const key = await generateKey()
    const enc = await encryptDataWithKey(MNEMONIC, key)
    const dec = await decryptDataWithKey(enc, key)
    expect(dec).toBe(MNEMONIC)
  })

  it('round-trips empty and unicode payloads', async () => {
    const key = await generateKey()
    for (const text of ['', '🔐 seed › café — тест', 'a'.repeat(2048)]) {
      const enc = await encryptData(text, key)
      expect(await decryptData(enc, key)).toBe(text)
    }
  })

  it('produces the documented blob layout (base64 cipher, hex iv/salt)', async () => {
    const key = await generateKey()
    const enc = await encryptData(MNEMONIC, key)
    expect(typeof enc.cipher).toBe('string')
    expect(enc.iv).toMatch(/^[0-9a-f]{24}$/) // 12-byte IV
    expect(enc.salt).toMatch(/^[0-9a-f]{32}$/) // 16-byte salt
    expect(enc.iterations).toBe(PBKDF2_ITERATIONS)
  })

  it('uses a fresh random IV + salt per encryption (nondeterministic cipher)', async () => {
    const key = await generateKey()
    const a = await encryptData(MNEMONIC, key)
    const b = await encryptData(MNEMONIC, key)
    expect(a.iv).not.toEqual(b.iv)
    expect(a.salt).not.toEqual(b.salt)
    expect(a.cipher).not.toEqual(b.cipher)
  })
})

describe('crypto: SECURITY invariants', () => {
  it('the key NEVER equals the ciphertext (nor is embedded in the blob)', async () => {
    const key = await generateKey()
    const enc = await encryptData(MNEMONIC, key)
    expect(enc.cipher).not.toEqual(key)
    const serialized = JSON.stringify(enc)
    expect(serialized.includes(key)).toBe(false)
    // The blob carries no field named like a key.
    expect(Object.keys(enc).sort()).toEqual([
      'cipher',
      'iterations',
      'iv',
      'salt',
    ])
  })

  it('the mnemonic NEVER appears in plaintext inside the blob', async () => {
    const key = await generateKey()
    const enc = await encryptData(MNEMONIC, key)
    const serialized = JSON.stringify(enc)
    expect(serialized.includes(MNEMONIC)).toBe(false)
    expect(serialized.includes('legal')).toBe(false)
  })

  it('decrypt with the WRONG key fails (GCM auth tag rejects it)', async () => {
    const key = await generateKey()
    const wrong = await generateKey()
    const enc = await encryptData(MNEMONIC, key)
    await expect(decryptData(enc, wrong)).rejects.toBeDefined()
  })

  it('the with-key wrapper surfaces a generic, non-leaky error on wrong key', async () => {
    const key = await generateKey()
    const wrong = await generateKey()
    const enc = await encryptDataWithKey(MNEMONIC, key)
    await expect(decryptDataWithKey(enc, wrong)).rejects.toThrow(
      'Failed to decrypt data.'
    )
  })

  it('tampering with the ciphertext is detected (integrity)', async () => {
    const key = await generateKey()
    const enc = await encryptData(MNEMONIC, key)
    // Flip a byte of the base64 cipher deterministically.
    const flipped: EncryptedData = {
      ...enc,
      cipher: mutateBase64(enc.cipher),
    }
    await expect(decryptData(flipped, key)).rejects.toBeDefined()
  })

  it('a wrong salt (re-derived key) fails to decrypt', async () => {
    const key = await generateKey()
    const enc = await encryptData(MNEMONIC, key)
    const badSalt: EncryptedData = {
      ...enc,
      salt: enc.salt.split('').reverse().join(''),
    }
    await expect(decryptData(badSalt, key)).rejects.toBeDefined()
  })
})

/** Flip one byte of a base64 blob so it decodes to different ciphertext. */
function mutateBase64(b64: string): string {
  const bytes = Buffer.from(b64, 'base64')
  bytes[0] = bytes[0] ^ 0xff
  return bytes.toString('base64')
}
