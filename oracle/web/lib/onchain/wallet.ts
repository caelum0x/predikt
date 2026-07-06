/**
 * The wallet: mnemonic lifecycle + unlocked signing.
 *
 * Ported from the native wallet's create/import/derive flow, re-expressed for
 * the web with viem accounts and WebCrypto-backed at-rest encryption.
 *
 * Pipeline:
 *   bip39 generate/import  ->  viem `mnemonicToAccount(m/44'/60'/0'/0/0)`
 *   ->  derive address     ->  encrypt mnemonic under a fresh device key
 *   ->  persist (ciphertext + device key in SEPARATE stores)
 *
 * SECURITY: the raw mnemonic is NEVER returned to or exposed to the UI. It is
 * held only transiently inside these functions long enough to derive an address
 * or a signing account, then dropped. Callers get an address (for display) and,
 * after `unlock`, a viem `WalletClient` + `Account` for signing — but never the
 * secret phrase itself.
 */

import { generateMnemonic, validateMnemonic } from 'bip39'
import {
  createWalletClient,
  http,
  type Account,
  type Address,
  type WalletClient,
} from 'viem'
import { mnemonicToAccount } from 'viem/accounts'
import {
  getChainConfig,
  PRIMARY_CHAIN_KEY,
  resolveRpcHttp,
  type ChainKey,
} from './chains'
import { encryptDataWithKey, decryptDataWithKey, generateKey } from './crypto'
import {
  hasStoredWallet,
  loadWallet,
  persistWallet,
  wipeWallet,
} from './storage'

/** Standard EVM account derivation path (index 0). Matches the contracts app. */
const DERIVATION_PATH = "m/44'/60'/0'/0/0" as const

/** An unlocked, ready-to-sign handle. Does NOT contain the mnemonic. */
export interface UnlockedWallet {
  address: Address
  account: Account
  /** Build a wallet client bound to `chainKey` for signing/sending. */
  walletClient: (chainKey: ChainKey) => WalletClient
}

/** Derive the index-0 EVM account from a validated mnemonic. */
function accountFromMnemonic(mnemonic: string): Account {
  // viem's default path is m/44'/60'/0'/0/0 (addressIndex 0); pinned explicitly.
  return mnemonicToAccount(mnemonic, { path: DERIVATION_PATH })
}

/** Derive the index-0 address for a mnemonic without persisting anything. */
function addressFromMnemonic(mnemonic: string): Address {
  return accountFromMnemonic(mnemonic).address
}

/**
 * Encrypt + persist a mnemonic under a fresh device key, returning the derived
 * address. The mnemonic is dropped after this call. Internal — callers use
 * `createWallet` / `importWallet`.
 */
async function persistMnemonic(mnemonic: string): Promise<Address> {
  const address = addressFromMnemonic(mnemonic)
  const deviceKey = await generateKey()
  const ciphertext = await encryptDataWithKey(mnemonic, deviceKey)
  await persistWallet(ciphertext, deviceKey)
  return address
}

/**
 * Create a brand-new wallet: generate a 12-word (128-bit) BIP-39 mnemonic,
 * derive the address, encrypt + persist. Returns the address only — the
 * mnemonic never leaves this function.
 */
export async function createWallet(): Promise<Address> {
  const mnemonic = generateMnemonic(256)
  return persistMnemonic(mnemonic)
}

/**
 * Import an existing wallet from a user-supplied mnemonic. Validates the phrase
 * (BIP-39 checksum) before deriving/persisting. Throws on an invalid phrase.
 */
export async function importWallet(mnemonicInput: string): Promise<Address> {
  const mnemonic = mnemonicInput.trim().replace(/\s+/g, ' ').toLowerCase()
  if (!validateMnemonic(mnemonic)) {
    throw new Error('Invalid recovery phrase.')
  }
  return persistMnemonic(mnemonic)
}

/** True when an encrypted wallet exists on this device. */
export function hasWallet(): boolean {
  return hasStoredWallet()
}

/**
 * Read the stored wallet's address WITHOUT unlocking for signing. Decrypts the
 * mnemonic transiently to derive the address, then drops it. Returns null when
 * no wallet is stored.
 */
export async function getAddress(): Promise<Address | null> {
  const stored = await loadWallet()
  if (!stored) return null
  const mnemonic = await decryptDataWithKey(stored.ciphertext, stored.deviceKey)
  return addressFromMnemonic(mnemonic)
}

/**
 * Unlock the wallet for signing. Decrypts the mnemonic, derives the signing
 * account, and returns a handle exposing the address + a per-chain
 * `WalletClient` factory. The mnemonic is dropped once the account is derived;
 * only the derived account (which the UI cannot reverse into a phrase) is
 * retained by the returned closure.
 */
export async function unlock(): Promise<UnlockedWallet> {
  const stored = await loadWallet()
  if (!stored) {
    throw new Error('No wallet found on this device.')
  }
  const mnemonic = await decryptDataWithKey(stored.ciphertext, stored.deviceKey)
  const account = accountFromMnemonic(mnemonic)
  const address = account.address

  const walletClient = (chainKey: ChainKey): WalletClient => {
    const config = getChainConfig(chainKey)
    return createWalletClient({
      account,
      chain: config.viemChain,
      transport: http(resolveRpcHttp(chainKey)),
    })
  }

  return { address, account, walletClient }
}

/** Convenience: unlock a wallet client for the primary settlement chain. */
export async function unlockPrimary(): Promise<{
  address: Address
  account: Account
  walletClient: WalletClient
}> {
  const w = await unlock()
  return {
    address: w.address,
    account: w.account,
    walletClient: w.walletClient(PRIMARY_CHAIN_KEY),
  }
}

/** Permanently remove the wallet (ciphertext + device key) from this device. */
export async function wipe(): Promise<void> {
  await wipeWallet()
}
