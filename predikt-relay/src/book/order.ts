import type { SignedOrder } from "@predikt/orders";
import { OrderSide } from "../orders.ts";

// A resting order in the relay book: the signed EIP-712 order plus the
// off-chain bookkeeping (hash, remaining maker amount, status, timestamps).
// `remainingMaker` mirrors the exchange's OrderStatus.remaining semantics:
// it counts down in *maker-amount* units as fills settle on-chain.

export type OrderStatus = "OPEN" | "PARTIALLY_FILLED" | "FILLED" | "CANCELLED";

export interface BookOrder {
    hash: `0x${string}`;
    order: SignedOrder;
    tokenId: string;
    side: OrderSide;
    /** maker's full maker amount (18dp shares for SELL, 6dp USDC for BUY) */
    makerAmount: bigint;
    takerAmount: bigint;
    /** remaining fillable maker amount; starts == makerAmount */
    remainingMaker: bigint;
    status: OrderStatus;
    /** price in 1e18 fixed point, oriented as USDC-per-share for the book */
    priceWad: bigint;
    createdAt: number;
    updatedAt: number;
}

export const ONE_WAD = 10n ** 18n;

/**
 * Order price, computed byte-for-byte identically to
 * CalculatorHelper._calculatePrice in the exchange:
 *   BUY:  makerAmount * 1e18 / takerAmount
 *   SELL: takerAmount * 1e18 / makerAmount
 *
 * Because collateral (USDC) is 6dp and outcome tokens are 18dp, the resulting
 * value is NOT a clean 1e18 fixed-point fraction — it carries the same decimal
 * skew the contract uses. That is intentional: every price in the relay is
 * produced by this one function, so the crossing check and price-time ordering
 * are internally consistent AND consistent with the on-chain isCrossing. Do not
 * treat this as a normalized 0..1e18 probability; use it only for relative
 * ordering and crossing, exactly as the contract does.
 */
export function priceWad(side: OrderSide, makerAmount: bigint, takerAmount: bigint): bigint {
    if (side === OrderSide.BUY) {
        return takerAmount === 0n ? 0n : (makerAmount * ONE_WAD) / takerAmount;
    }
    return makerAmount === 0n ? 0n : (takerAmount * ONE_WAD) / makerAmount;
}

/**
 * taking = making * takerAmount / makerAmount  (floor), matching
 * CalculatorHelper.calculateTakingAmount exactly.
 */
export function calculateTaking(making: bigint, makerAmount: bigint, takerAmount: bigint): bigint {
    if (makerAmount === 0n) return 0n;
    return (making * takerAmount) / makerAmount;
}

function absMin(a: bigint, b: bigint): bigint {
    return a < b ? a : b;
}

/**
 * Fee mirror of CalculatorHelper.calculateFee. `outcomeTokens` is the number of
 * outcome-token units involved (taking for BUY, making for SELL). Used only for
 * off-chain reporting; the on-chain contract is the source of truth.
 */
export function calculateFee(
    feeRateBps: bigint,
    outcomeTokens: bigint,
    makerAmount: bigint,
    takerAmount: bigint,
    side: OrderSide,
): bigint {
    if (feeRateBps <= 0n) return 0n;
    const price = priceWad(side, makerAmount, takerAmount);
    if (price <= 0n || price > ONE_WAD) return 0n;
    const BPS = 10_000n;
    if (side === OrderSide.BUY) {
        return (feeRateBps * absMin(price, ONE_WAD - price) * outcomeTokens) / (price * BPS);
    }
    return (feeRateBps * absMin(price, ONE_WAD - price) * outcomeTokens) / (BPS * ONE_WAD);
}

export function statusFromRemaining(remaining: bigint, makerAmount: bigint): OrderStatus {
    if (remaining <= 0n) return "FILLED";
    if (remaining < makerAmount) return "PARTIALLY_FILLED";
    return "OPEN";
}
