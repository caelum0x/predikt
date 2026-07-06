// Per-user API-key storage, mirroring herald's storage.ts.
//
// Maps Telegram user id -> Predikt/oracle API key, persisted to keys.json in the
// working directory. This is the exact same "store the key like herald" approach,
// just keyed by Telegram user id instead of Discord user id.

import * as fs from 'fs';

const KEYS_FILE = 'keys.json';

export const oracleKeyMap: { [telegramUserId: string]: string } = loadKeyMap();

export function saveKeyMap(): void {
  fs.writeFileSync(KEYS_FILE, JSON.stringify(oracleKeyMap));
}

export function loadKeyMap(): { [telegramUserId: string]: string } {
  try {
    return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
  } catch (e) {
    if (!(e instanceof Error) || !e.message.includes('ENOENT')) throw e;
    return {};
  }
}
