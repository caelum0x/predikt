/**
 * On-chain single-side trading: build + EIP-712 sign real CTFExchange orders
 * with the in-app wallet, then submit / cancel / read them through the Predikt
 * relay (the off-chain price-time-priority book + on-chain matcher).
 *
 * This is Predikt's `@predikt/orders` signing core, inlined here so the web
 * bundle carries no extra dependency (viem is already present) and — crucially —
 * so orders are signed against the ACTUAL deployed exchange address
 * (`NEXT_PUBLIC_ONCHAIN_EXCHANGE`) rather than the SDK's per-chain hardcoded
 * constant. The EIP-712 domain, `Order` struct, and BUY/SELL amount math are the
 * exact same load-bearing shapes used by the SDK order-builder and verified by
 * both the relay (`verifyTypedData`) and the on-chain `Hashing.hashOrder`
 * (`Hashing("Polymarket CTF Exchange", "1")`). Any divergence here would make
 * every signature invalid, so these constants must not drift.
 *
 * REAL ONLY: every order is a real EIP-712 signature that settles via the
 * relay's real `matchOrders` / `fillOrder` transactions. Nothing here fabricates
 * a fill. When the relay URL or on-chain deployment is absent, the trading
 * functions throw `RelayUnavailableError` and the UI falls back to the
 * mint/merge/redeem path — it never fakes a market fill.
 */

import {
  hashTypedData,
  parseUnits,
  type Address,
  type Hex,
  type WalletClient,
} from 'viem'
import { getOnchainAddresses } from './addresses'
import { PRIMARY_CHAIN_KEY, getChainConfig } from './chains'

// --------------------------------------------------------------------------- //
//                     EIP-712 domain + Order struct (SDK core)                 //
// --------------------------------------------------------------------------- //

/**
 * Load-bearing constants baked into the deployed CTFExchange
 * (`Hashing("Polymarket CTF Exchange", "1")`). Must match the relay
 * (`EIP712_DOMAIN_NAME` / `_VERSION`) and the contract exactly.
 */
const EIP712_DOMAIN_NAME = 'Polymarket CTF Exchange'
const EIP712_DOMAIN_VERSION = '1'

/**
 * Dedicated relay-authentication EIP-712 message used to prove maker ownership
 * when cancelling a resting order. This is NOT the on-chain `Order` domain — it
 * is a separate `Predikt Relay` domain that is never submitted to any contract;
 * its only consumer is the relay's `DELETE /orders/:hash` authenticator. Must
 * match `@predikt/orders` `cancelDomain` / `CANCEL_TYPES` exactly.
 */
const CANCEL_DOMAIN_NAME = 'Predikt Relay'
const CANCEL_DOMAIN_VERSION = '1'
const CANCEL_TYPES = {
  Cancel: [
    { name: 'orderHash', type: 'bytes32' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const

/** How long a cancel authorisation stays valid, in seconds. */
const CANCEL_DEADLINE_WINDOW_SECS = 300

/** The `Order` typed-data struct — field order matches OrderStructs.sol. */
const ORDER_TYPES = {
  Order: [
    { name: 'salt', type: 'uint256' },
    { name: 'maker', type: 'address' },
    { name: 'signer', type: 'address' },
    { name: 'taker', type: 'address' },
    { name: 'tokenId', type: 'uint256' },
    { name: 'makerAmount', type: 'uint256' },
    { name: 'takerAmount', type: 'uint256' },
    { name: 'expiration', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'feeRateBps', type: 'uint256' },
    { name: 'side', type: 'uint8' },
    { name: 'signatureType', type: 'uint8' },
  ],
} as const

/** USDC + conditional tokens are both 6-decimal on the settlement chain. */
const COLLATERAL_DECIMALS = 6

/** Order side (matches OrderStructs.sol + SDK `Side`). */
export const OrderSide = { BUY: 0, SELL: 1 } as const
export type OrderSideValue = (typeof OrderSide)[keyof typeof OrderSide]

/** Signature type — the relay only accepts EOA orders, which is what we sign. */
export const SignatureType = { EOA: 0, POLY_PROXY: 1, POLY_GNOSIS_SAFE: 2 } as const

const ZERO_ADDRESS =
  '0x0000000000000000000000000000000000000000' as const

/**
 * A signed EIP-712 order in the exact wire shape the relay's `POST /orders`
 * accepts (all uint256 fields as decimal strings; side/signatureType as the
 * numeric enum). This is Predikt's `@predikt/orders` `SignedOrder`.
 */
export interface SignedOrder {
  salt: string
  maker: Address
  signer: Address
  taker: Address
  tokenId: string
  makerAmount: string
  takerAmount: string
  expiration: string
  nonce: string
  feeRateBps: string
  side: OrderSideValue
  signatureType: number
  signature: Hex
}

// --------------------------------------------------------------------------- //
//                                   Errors                                     //
// --------------------------------------------------------------------------- //

/** Thrown when the relay URL / on-chain deployment isn't configured, so the UI
 *  can gracefully fall back to mint/merge/redeem instead of faking a fill. */
export class RelayUnavailableError extends Error {
  constructor(message = 'The order relay is not available right now.') {
    super(message)
    this.name = 'RelayUnavailableError'
  }
}

/** Thrown when the relay rejects a request; carries the relay's message. */
export class RelayError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'RelayError'
  }
}

// --------------------------------------------------------------------------- //
//                              Relay configuration                             //
// --------------------------------------------------------------------------- //

/** Base URL of the Predikt relay, or null when unconfigured. */
export function relayBaseUrl(): string | null {
  const raw = process.env.NEXT_PUBLIC_ONCHAIN_RELAY_URL
  if (!raw) return null
  const trimmed = raw.trim().replace(/\/+$/, '')
  return trimmed.length > 0 ? trimmed : null
}

/** Whether real relay-backed order trading is available in this deployment. */
export function isRelayTradingEnabled(): boolean {
  return relayBaseUrl() !== null && getOnchainAddresses() !== null
}

// --------------------------------------------------------------------------- //
//                              Amount / price math                             //
// --------------------------------------------------------------------------- //

function decimalPlaces(num: number): number {
  if (Number.isInteger(num)) return 0
  const parts = num.toString().split('.')
  return parts.length <= 1 ? 0 : parts[1].length
}

function roundDown(num: number, decimals: number): number {
  if (decimalPlaces(num) <= decimals) return num
  return Math.floor(num * 10 ** decimals) / 10 ** decimals
}

function roundUp(num: number, decimals: number): number {
  if (decimalPlaces(num) <= decimals) return num
  return Math.ceil(num * 10 ** decimals) / 10 ** decimals
}

function roundNormal(num: number, decimals: number): number {
  if (decimalPlaces(num) <= decimals) return num
  return Math.round((num + Number.EPSILON) * 10 ** decimals) / 10 ** decimals
}

/**
 * Two-decimal tick rounding config (0.01 tick — cents), mirroring the SDK's
 * ROUNDING_CONFIG["0.01"]: price to 2dp, size to 2dp, amount to 4dp.
 */
const ROUND = { price: 2, size: 2, amount: 4 } as const

/**
 * BUY/SELL maker & taker raw amounts for a LIMIT order (price + size), matching
 * the SDK's `getOrderRawAmounts`. BUY: maker=USDC, taker=shares; SELL flips.
 */
function limitRawAmounts(
  side: OrderSideValue,
  size: number,
  price: number
): { rawMakerAmt: number; rawTakerAmt: number } {
  const rawPrice = roundNormal(price, ROUND.price)
  if (side === OrderSide.BUY) {
    const rawTakerAmt = roundDown(size, ROUND.size)
    let rawMakerAmt = rawTakerAmt * rawPrice
    if (decimalPlaces(rawMakerAmt) > ROUND.amount) {
      rawMakerAmt = roundUp(rawMakerAmt, ROUND.amount + 4)
      if (decimalPlaces(rawMakerAmt) > ROUND.amount) {
        rawMakerAmt = roundDown(rawMakerAmt, ROUND.amount)
      }
    }
    return { rawMakerAmt, rawTakerAmt }
  }
  const rawMakerAmt = roundDown(size, ROUND.size)
  let rawTakerAmt = rawMakerAmt * rawPrice
  if (decimalPlaces(rawTakerAmt) > ROUND.amount) {
    rawTakerAmt = roundUp(rawTakerAmt, ROUND.amount + 4)
    if (decimalPlaces(rawTakerAmt) > ROUND.amount) {
      rawTakerAmt = roundDown(rawTakerAmt, ROUND.amount)
    }
  }
  return { rawMakerAmt, rawTakerAmt }
}

/**
 * MARKET order raw amounts, matching the SDK's `getMarketOrderRawAmounts`.
 * BUY: `amount` is USDC to spend (maker), taker = amount/price shares.
 * SELL: `amount` is shares to sell (maker), taker = amount*price USDC.
 */
function marketRawAmounts(
  side: OrderSideValue,
  amount: number,
  price: number
): { rawMakerAmt: number; rawTakerAmt: number } {
  const rawPrice = roundDown(price, ROUND.price)
  if (side === OrderSide.BUY) {
    const rawMakerAmt = roundDown(amount, ROUND.size)
    let rawTakerAmt = rawMakerAmt / rawPrice
    if (decimalPlaces(rawTakerAmt) > ROUND.amount) {
      rawTakerAmt = roundUp(rawTakerAmt, ROUND.amount + 4)
      if (decimalPlaces(rawTakerAmt) > ROUND.amount) {
        rawTakerAmt = roundDown(rawTakerAmt, ROUND.amount)
      }
    }
    return { rawMakerAmt, rawTakerAmt }
  }
  const rawMakerAmt = roundDown(amount, ROUND.size)
  let rawTakerAmt = rawMakerAmt * rawPrice
  if (decimalPlaces(rawTakerAmt) > ROUND.amount) {
    rawTakerAmt = roundUp(rawTakerAmt, ROUND.amount + 4)
    if (decimalPlaces(rawTakerAmt) > ROUND.amount) {
      rawTakerAmt = roundDown(rawTakerAmt, ROUND.amount)
    }
  }
  return { rawMakerAmt, rawTakerAmt }
}

// --------------------------------------------------------------------------- //
//                            Build + sign an order                             //
// --------------------------------------------------------------------------- //

/** A cryptographically-random 256-bit salt (bounded to fit uint256 safely). */
function generateSalt(): string {
  const bytes = new Uint8Array(32)
  globalThis.crypto.getRandomValues(bytes)
  let salt = 0n
  for (const b of bytes) salt = (salt << 8n) | BigInt(b)
  return salt.toString()
}

function requireExchange(): { exchange: Address; chainId: number } {
  const addresses = getOnchainAddresses()
  if (!addresses) throw new RelayUnavailableError()
  const chainId = getChainConfig(PRIMARY_CHAIN_KEY).chainId
  return { exchange: addresses.exchange, chainId }
}

interface BuildOrderInput {
  /** Decimal ERC-1155 tokenId of the outcome (YES or NO) being traded. */
  tokenId: string
  side: OrderSideValue
  rawMakerAmt: number
  rawTakerAmt: number
  /** Unix seconds; 0 == no expiration (used for market orders). */
  expiration: number
}

/**
 * Assemble the raw `Order`, EIP-712 sign it with the wallet against the DEPLOYED
 * exchange domain, and return the wire-shaped `SignedOrder`. `walletAddress` is
 * both maker and signer (EOA orders only — what the relay accepts).
 */
async function signBuiltOrder(
  wallet: WalletClient,
  walletAddress: Address,
  input: BuildOrderInput
): Promise<SignedOrder> {
  const { exchange, chainId } = requireExchange()

  const makerAmount = parseUnits(
    input.rawMakerAmt.toString(),
    COLLATERAL_DECIMALS
  ).toString()
  const takerAmount = parseUnits(
    input.rawTakerAmt.toString(),
    COLLATERAL_DECIMALS
  ).toString()

  const order = {
    salt: generateSalt(),
    maker: walletAddress,
    signer: walletAddress,
    taker: ZERO_ADDRESS as Address,
    tokenId: input.tokenId,
    makerAmount,
    takerAmount,
    expiration: Math.max(0, Math.floor(input.expiration)).toString(),
    nonce: '0',
    feeRateBps: '0',
    side: input.side,
    signatureType: SignatureType.EOA,
  }

  const domain = {
    name: EIP712_DOMAIN_NAME,
    version: EIP712_DOMAIN_VERSION,
    chainId,
    verifyingContract: exchange,
  } as const

  const message = {
    salt: BigInt(order.salt),
    maker: order.maker,
    signer: order.signer,
    taker: order.taker,
    tokenId: BigInt(order.tokenId),
    makerAmount: BigInt(order.makerAmount),
    takerAmount: BigInt(order.takerAmount),
    expiration: BigInt(order.expiration),
    nonce: BigInt(order.nonce),
    feeRateBps: BigInt(order.feeRateBps),
    side: order.side,
    signatureType: order.signatureType,
  } as const

  const signature = await wallet.signTypedData({
    account: wallet.account ?? walletAddress,
    domain,
    types: ORDER_TYPES,
    primaryType: 'Order',
    message,
  })

  return { ...order, signature }
}

/** The EIP-712 order hash — matches the relay's `hashOrder` / `Hashing.hashOrder`. */
export function orderHash(order: SignedOrder): Hex {
  const { exchange, chainId } = requireExchange()
  return hashTypedData({
    domain: {
      name: EIP712_DOMAIN_NAME,
      version: EIP712_DOMAIN_VERSION,
      chainId,
      verifyingContract: exchange,
    },
    types: ORDER_TYPES,
    primaryType: 'Order',
    message: {
      salt: BigInt(order.salt),
      maker: order.maker,
      signer: order.signer,
      taker: order.taker,
      tokenId: BigInt(order.tokenId),
      makerAmount: BigInt(order.makerAmount),
      takerAmount: BigInt(order.takerAmount),
      expiration: BigInt(order.expiration),
      nonce: BigInt(order.nonce),
      feeRateBps: BigInt(order.feeRateBps),
      side: order.side,
      signatureType: order.signatureType,
    },
  })
}

// --------------------------------------------------------------------------- //
//                         Public order-building helpers                        //
// --------------------------------------------------------------------------- //

/** Common inputs for a single-side order on one outcome token. */
export interface OrderRequestBase {
  wallet: WalletClient
  walletAddress: Address
  /** Decimal ERC-1155 tokenId of the outcome being traded (YES or NO). */
  tokenId: string
}

/** A LIMIT order: explicit `price` in [0,1] and `size` in shares. */
export interface LimitOrderRequest extends OrderRequestBase {
  price: number
  size: number
  /** Optional expiration (unix seconds). 0/undefined == good-till-cancelled. */
  expiration?: number
}

/**
 * A MARKET order. For BUY, `amount` is USDC to spend; for SELL, `amount` is
 * shares to sell. `price` is the marketable limit (worst acceptable) price used
 * to bound the order — pass the current best ask (buy) / bid (sell), or 1 / a
 * conservative value when the book is empty and the order should sweep.
 */
export interface MarketOrderRequest extends OrderRequestBase {
  amount: number
  price: number
}

/** Build + sign a single-side BUY order (LIMIT). */
export function buildBuyLimitOrder(req: LimitOrderRequest): Promise<SignedOrder> {
  const { rawMakerAmt, rawTakerAmt } = limitRawAmounts(
    OrderSide.BUY,
    req.size,
    req.price
  )
  return signBuiltOrder(req.wallet, req.walletAddress, {
    tokenId: req.tokenId,
    side: OrderSide.BUY,
    rawMakerAmt,
    rawTakerAmt,
    expiration: req.expiration ?? 0,
  })
}

/** Build + sign a single-side SELL order (LIMIT). */
export function buildSellLimitOrder(
  req: LimitOrderRequest
): Promise<SignedOrder> {
  const { rawMakerAmt, rawTakerAmt } = limitRawAmounts(
    OrderSide.SELL,
    req.size,
    req.price
  )
  return signBuiltOrder(req.wallet, req.walletAddress, {
    tokenId: req.tokenId,
    side: OrderSide.SELL,
    rawMakerAmt,
    rawTakerAmt,
    expiration: req.expiration ?? 0,
  })
}

/** Build + sign a single-side BUY order (MARKET: spend `amount` USDC). */
export function buildBuyOrder(req: MarketOrderRequest): Promise<SignedOrder> {
  const { rawMakerAmt, rawTakerAmt } = marketRawAmounts(
    OrderSide.BUY,
    req.amount,
    req.price
  )
  return signBuiltOrder(req.wallet, req.walletAddress, {
    tokenId: req.tokenId,
    side: OrderSide.BUY,
    rawMakerAmt,
    rawTakerAmt,
    expiration: 0,
  })
}

/** Build + sign a single-side SELL order (MARKET: sell `amount` shares). */
export function buildSellOrder(req: MarketOrderRequest): Promise<SignedOrder> {
  const { rawMakerAmt, rawTakerAmt } = marketRawAmounts(
    OrderSide.SELL,
    req.amount,
    req.price
  )
  return signBuiltOrder(req.wallet, req.walletAddress, {
    tokenId: req.tokenId,
    side: OrderSide.SELL,
    rawMakerAmt,
    rawTakerAmt,
    expiration: 0,
  })
}

/**
 * Sign a prepared order request (thin wrapper kept for symmetry with the SDK's
 * `signOrder`; the build* helpers already sign, so this simply forwards).
 */
export function signOrder(order: SignedOrder): SignedOrder {
  return order
}

// --------------------------------------------------------------------------- //
//                               Relay HTTP client                              //
// --------------------------------------------------------------------------- //

/** Consistent relay response envelope: { success, data?, error? }. */
interface RelayEnvelope<T> {
  success: boolean
  data?: T
  error?: string
}

async function relayFetch<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const base = relayBaseUrl()
  if (!base) throw new RelayUnavailableError()

  let res: Response
  try {
    res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(init?.headers ?? {}),
      },
    })
  } catch (err) {
    throw new RelayUnavailableError(
      err instanceof Error ? `relay unreachable: ${err.message}` : undefined
    )
  }

  let body: RelayEnvelope<T> | null = null
  try {
    body = (await res.json()) as RelayEnvelope<T>
  } catch {
    // fall through to status-based error
  }

  if (!res.ok || !body || body.success === false) {
    const message =
      body?.error ?? `relay request failed (${res.status})`
    throw new RelayError(message, res.status)
  }
  return body.data as T
}

/** What the relay reports back after accepting + matching a submitted order. */
export interface SubmitOrderResult {
  hash: Hex
  status: 'OPEN' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED'
  matched: boolean
  txHash?: Hex
  fills: { makerHash: Hex; shares: string; makerFillAmount: string }[]
}

/** Submit a signed order to the relay's `POST /orders`. */
export function submitOrder(order: SignedOrder): Promise<SubmitOrderResult> {
  return relayFetch<SubmitOrderResult>('/orders', {
    method: 'POST',
    body: JSON.stringify(order),
  })
}

/**
 * Cancel a resting order by hash via `DELETE /orders/:hash`.
 *
 * Authentication is cryptographic: the maker signs an EIP-712 "Cancel" message
 * over { orderHash, deadline } against the dedicated `Predikt Relay` domain with
 * the in-app wallet, and the relay recovers the signer and requires it to equal
 * the order's maker. A plaintext maker string is no longer accepted.
 */
export async function cancelOrder(
  hash: Hex,
  params: { wallet: WalletClient; walletAddress: Address }
): Promise<{ hash: Hex; status: 'CANCELLED' }> {
  const { chainId } = requireExchange()
  const deadline = Math.floor(Date.now() / 1000) + CANCEL_DEADLINE_WINDOW_SECS

  const signature = await params.wallet.signTypedData({
    account: params.wallet.account ?? params.walletAddress,
    domain: {
      name: CANCEL_DOMAIN_NAME,
      version: CANCEL_DOMAIN_VERSION,
      chainId,
    },
    types: CANCEL_TYPES,
    primaryType: 'Cancel',
    message: { orderHash: hash, deadline: BigInt(deadline) },
  })

  return relayFetch<{ hash: Hex; status: 'CANCELLED' }>(`/orders/${hash}`, {
    method: 'DELETE',
    body: JSON.stringify({ signature, deadline }),
  })
}

/** One side of a resting order as reported by the relay. */
export interface RelayOrderView {
  hash: Hex
  maker: Address
  tokenId: string
  side: 'BUY' | 'SELL'
  makerAmount: string
  takerAmount: string
  remainingMaker: string
  priceWad: string
  status: 'OPEN' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED'
  createdAt: number
  updatedAt: number
}

/** Aggregated resting book for a token: sorted bids + asks. */
export interface RelayBook {
  tokenId: string
  bids: RelayOrderView[]
  asks: RelayOrderView[]
}

/** Read the resting order book for an outcome token via `GET /book`. */
export function getBook(tokenId: string): Promise<RelayBook> {
  return relayFetch<RelayBook>(`/book?tokenId=${encodeURIComponent(tokenId)}`)
}

/** Read a maker's own orders via `GET /orders?maker=`. */
export function getOrders(
  maker: Address
): Promise<{ maker: Address; orders: RelayOrderView[] }> {
  return relayFetch<{ maker: Address; orders: RelayOrderView[] }>(
    `/orders?maker=${encodeURIComponent(maker)}`
  )
}

/** A settled fill as recorded by the relay indexer. */
export interface RelayTrade {
  tokenId: string
  maker?: string
  taker?: string
  makerHash?: string
  shares?: string
  price?: string
  priceWad?: string
  txHash?: string
  side?: 'BUY' | 'SELL'
  timestamp?: number
  blockNumber?: number
}

/** Read recent settled trades for an outcome token via `GET /trades`. */
export function getTrades(
  tokenId: string
): Promise<{ tokenId: string; trades: RelayTrade[] }> {
  return relayFetch<{ tokenId: string; trades: RelayTrade[] }>(
    `/trades?tokenId=${encodeURIComponent(tokenId)}`
  )
}

// --------------------------------------------------------------------------- //
//                              Price helpers (UI)                              //
// --------------------------------------------------------------------------- //

/** Convert a relay WAD price (1e18) string into a [0,1] number. */
export function priceFromWad(wad: string): number {
  try {
    return Number(BigInt(wad)) / 1e18
  } catch {
    return 0
  }
}

/**
 * Best ask (lowest sell price) from a book, in [0,1]. Asks are returned sorted
 * best-first by the relay; fall back to a scan for safety.
 */
export function bestAsk(book: RelayBook): number | null {
  if (book.asks.length === 0) return null
  return book.asks.reduce(
    (best, o) => Math.min(best, priceFromWad(o.priceWad)),
    Infinity
  )
}

/** Best bid (highest buy price) from a book, in [0,1]. */
export function bestBid(book: RelayBook): number | null {
  if (book.bids.length === 0) return null
  return book.bids.reduce(
    (best, o) => Math.max(best, priceFromWad(o.priceWad)),
    0
  )
}
