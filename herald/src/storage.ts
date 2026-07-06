
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
type StoredMap = { [k: string]: EncryptedEnvelope | string };

// In-memory map holds PLAINTEXT keys, so the rest of the bot is unchanged.
// Encryption/decryption happens only at the disk boundary (save/load).
export const manifoldMap: {[k: string]: string} = loadOracleMap();

export function saveOracleMap() {
    const out: StoredMap = {};
    for (const [userId, key] of Object.entries(manifoldMap)) {
        out[userId] = encrypt(key);
    }
    fs.writeFileSync(KEYS_FILE, JSON.stringify(out));
}

export function loadOracleMap(): {[k: string]: string} {
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

    const result: {[k: string]: string} = {};
    let migrated = false;
    for (const [userId, value] of Object.entries(raw)) {
        if (isEncryptedEnvelope(value)) {
            result[userId] = decrypt(value);
        } else if (typeof value === 'string') {
            // Legacy plaintext entry — decrypt() is a no-op; flag for re-encryption.
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
