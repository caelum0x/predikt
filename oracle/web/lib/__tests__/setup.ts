/**
 * Jest global setup for the on-chain / pure-math unit suite.
 *
 * This is TEST INFRASTRUCTURE, not a production mock: it only provides the
 * ambient browser globals (`window`, `localStorage`) that a bare Node test
 * environment lacks, so the real production code under test runs unchanged. It
 * does NOT stand in for any module under test — those are exercised for real.
 *
 * WebCrypto (`globalThis.crypto.subtle` + `getRandomValues`) is native on the
 * Node the tests run on, so `crypto.ts` uses the real SubtleCrypto — no polyfill.
 */

// --- Minimal in-memory localStorage, spec-compatible for our call sites. ---
class MemoryStorage implements Storage {
  private store = new Map<string, string>()
  get length(): number {
    return this.store.size
  }
  clear(): void {
    this.store.clear()
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null
  }
  removeItem(key: string): void {
    this.store.delete(key)
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value))
  }
}

const g = globalThis as unknown as {
  window?: unknown
  localStorage?: Storage
  sessionStorage?: Storage
}

if (typeof g.localStorage === 'undefined') {
  g.localStorage = new MemoryStorage()
}
if (typeof g.sessionStorage === 'undefined') {
  g.sessionStorage = new MemoryStorage()
}
if (typeof g.window === 'undefined') {
  // A tiny window shim: enough for the storage layer's `typeof window` and
  // event-target checks. No ReactNativeWebView, so the native bridge path is
  // never taken (web-fallback path is exercised instead).
  g.window = {
    localStorage: g.localStorage,
    sessionStorage: g.sessionStorage,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }
}

export {}
