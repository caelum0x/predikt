// AES-256-GCM encryption at rest for the per-user API key store.
//
// Each stored key is encrypted independently with a fresh random IV and a
// per-value random salt. The symmetric key is derived with scrypt from the
// required KEY_ENCRYPTION_SECRET environment variable. GCM's authentication
// tag protects each value against tampering.
//
// On-disk envelope (JSON): { v, salt, iv, tag, ct } — all binary fields base64.
// Legacy plaintext entries are plain strings; isEncryptedEnvelope() tells the
// two apart so the storage layer can migrate old files on first load.

import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256-bit key
const IV_LENGTH = 12; // 96-bit nonce, recommended for GCM
const SALT_LENGTH = 16;
const ENVELOPE_VERSION = 1;

export interface EncryptedEnvelope {
  v: number;
  salt: string;
  iv: string;
  tag: string;
  ct: string;
}

/**
 * Read the encryption secret from the environment. Throws if it is missing or
 * empty so the bot refuses to store keys with no protection.
 */
function requireSecret(): string {
  const secret = process.env.KEY_ENCRYPTION_SECRET;
  if (!secret || !secret.trim()) {
    throw new Error(
      'KEY_ENCRYPTION_SECRET is not set — it is required to encrypt users\' API keys at rest. ' +
        'Set it as an environment variable or in .env before starting the bot.'
    );
  }
  return secret;
}

/**
 * True when the encryption secret is present. Used at startup to warn loudly
 * rather than crashing mid-request.
 */
export function isEncryptionSecretPresent(): boolean {
  const secret = process.env.KEY_ENCRYPTION_SECRET;
  return Boolean(secret && secret.trim());
}

function deriveKey(secret: string, salt: Buffer): Buffer {
  return crypto.scryptSync(secret, salt, KEY_LENGTH);
}

/** Encrypt a single plaintext value into a self-describing envelope. */
export function encrypt(plaintext: string): EncryptedEnvelope {
  const secret = requireSecret();
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = deriveKey(secret, salt);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    v: ENVELOPE_VERSION,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ct: ct.toString('base64'),
  };
}

/** Decrypt an envelope produced by encrypt(). Throws on tampering or wrong secret. */
export function decrypt(envelope: EncryptedEnvelope): string {
  const secret = requireSecret();
  const salt = Buffer.from(envelope.salt, 'base64');
  const iv = Buffer.from(envelope.iv, 'base64');
  const tag = Buffer.from(envelope.tag, 'base64');
  const ct = Buffer.from(envelope.ct, 'base64');
  const key = deriveKey(secret, salt);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}

/**
 * Type guard: is this stored value an encrypted envelope (vs a legacy plaintext
 * string)? Used to detect entries that still need migrating.
 */
export function isEncryptedEnvelope(value: unknown): value is EncryptedEnvelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    'v' in value &&
    'salt' in value &&
    'iv' in value &&
    'tag' in value &&
    'ct' in value
  );
}
