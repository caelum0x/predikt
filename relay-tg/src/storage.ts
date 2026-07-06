// Per-user API-key storage, mirroring herald's storage.ts.
//
// Maps Telegram user id -> Predikt/oracle API key, persisted to keys.json in the
// working directory. Keys are encrypted at rest with AES-256-GCM (see crypto.ts);
// the in-memory map holds plaintext so the rest of the bot is unchanged. This is
// the exact same "store the key like herald" approach, just keyed by Telegram
// user id instead of Discord user id.

import * as fs from 'fs';
import {
  EncryptedEnvelope,
  decrypt,
  encrypt,
  isEncryptedEnvelope,
  isEncryptionSecretPresent,
} from './crypto';

const KEYS_FILE = 'keys.json';

// On-disk shape: userId -> encrypted envelope (new) or plaintext string (legacy).
type StoredMap = { [telegramUserId: string]: EncryptedEnvelope | string };

// In-memory map holds PLAINTEXT keys; encryption only happens at the disk boundary.
export const oracleKeyMap: { [telegramUserId: string]: string } = loadKeyMap();

export function saveKeyMap(): void {
  const out: StoredMap = {};
  for (const [userId, key] of Object.entries(oracleKeyMap)) {
    out[userId] = encrypt(key);
  }
  fs.writeFileSync(KEYS_FILE, JSON.stringify(out));
}

export function loadKeyMap(): { [telegramUserId: string]: string } {
  if (!isEncryptionSecretPresent()) {
    console.error(
      'WARNING: KEY_ENCRYPTION_SECRET is not set. Users\' API keys cannot be ' +
        'encrypted at rest — set it in the environment or .env before registering keys.'
    );
  }

  let raw: StoredMap;
  try {
    raw = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
  } catch (e) {
    if (!(e instanceof Error) || !e.message.includes('ENOENT')) throw e;
    return {};
  }

  const result: { [telegramUserId: string]: string } = {};
  let migrated = false;
  for (const [userId, value] of Object.entries(raw)) {
    if (isEncryptedEnvelope(value)) {
      result[userId] = decrypt(value);
    } else if (typeof value === 'string') {
      // Legacy plaintext entry — flag for re-encryption on first load.
      result[userId] = value;
      migrated = true;
    }
  }

  // First-load migration: if any entry was plaintext, rewrite the file encrypted.
  if (migrated) {
    const out: StoredMap = {};
    for (const [userId, key] of Object.entries(result)) {
      out[userId] = encrypt(key);
    }
    fs.writeFileSync(KEYS_FILE, JSON.stringify(out));
    console.log('Migrated existing plaintext keys.json to encrypted-at-rest format.');
  }

  return result;
}
