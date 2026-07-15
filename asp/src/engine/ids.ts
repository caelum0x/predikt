// ID and API-key generation + hashing. Keys are shown once at creation and
// only their SHA-256 hash is stored.

import { createHash, randomBytes, randomUUID } from 'node:crypto'

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 20)}`
}

export function newApiKey(): string {
  return `pk_${randomBytes(24).toString('hex')}`
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}
