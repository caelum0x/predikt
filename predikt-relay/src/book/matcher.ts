import { OrderSide } from "../orders.ts";
import type { BookOrder } from "./order.ts";
import { ONE_WAD, calculateTaking, priceWad } from "./order.ts";
import type { OrderBook } from "./book.ts";

// Price-time-priority matcher.
//
// The exchange settles fills in *maker-amount* units. `matchOrders` takes:
//   - takerFillAmount:   how much of the taker's makerAmount to consume
//   - makerFillAmounts[]: how much of each maker's makerAmount to consume
//
// COMPLEMENTARY (taker BUY vs maker SELL, or taker SELL vs maker BUY) is the
// classic crossed book. We match share-by-share against the best resting
// opposite orders, converting each side's fill into maker-amount units:
//
//   - A BUY order's maker amount is USDC (6dp); its "shares" side is takerAmount.
//   - A SELL order's maker amount is shares (18dp); its "USDC" side is takerAmount.
//
// We size each maker fill by the number of shares crossed, then convert to that
// order's maker units. The taker's fill is the sum expressed in taker maker units.

export interface PlannedFill {
    maker: BookOrder;
    /** shares crossed against this maker */
    shares: bigint;
    /** fill amount in the MAKER order's maker-amount units */
    makerFillAmount: bigint;
}

export interface MatchPlan {
    taker: BookOrder;
    fills: PlannedFill[];
    /** fill amount in the TAKER order's maker-amount units */
    takerFillAmount: bigint;
    /** total shares matched */
    totalShares: bigint;
}

/** Shares represented by `remainingMaker` of an order. */
export function remainingShares(o: BookOrder): bigint {
    if (o.side === OrderSide.BUY) {
        // BUY maker units are USDC; shares = remainingUSDC * takerAmount / makerAmount
        return calculateTaking(o.remainingMaker, o.makerAmount, o.takerAmount);
    }
    // SELL maker units already are shares.
    return o.remainingMaker;
}

/** Convert a share quantity into an order's maker-amount units (BUY: USDC, SELL: shares). */
export function sharesToMakerUnits(o: BookOrder, shares: bigint): bigint {
    if (o.side === OrderSide.SELL) return shares;
    // BUY: makerUnits(USDC) = shares * makerAmount / takerAmount  (floor)
    if (o.takerAmount === 0n) return 0n;
    return (shares * o.makerAmount) / o.takerAmount;
}

/** True when the taker order crosses the resting maker order (mirrors CalculatorHelper.isCrossing). */
export function crosses(taker: BookOrder, maker: BookOrder): boolean {
    // Both prices come from the same contract-faithful formula, so comparing
    // them directly reproduces CalculatorHelper._isCrossing exactly.
    const pt = priceWad(taker.side, taker.makerAmount, taker.takerAmount);
    const pm = priceWad(maker.side, maker.makerAmount, maker.takerAmount);
    if (taker.side === OrderSide.BUY && maker.side === OrderSide.SELL) {
        // taker willing to pay pt, maker wants pm — cross when pt >= pm
        return pt >= pm;
    }
    if (taker.side === OrderSide.SELL && maker.side === OrderSide.BUY) {
        return pm >= pt;
    }
    // same-side (MINT/MERGE) matching is not planned by the relay; skip.
    if (taker.side === OrderSide.BUY && maker.side === OrderSide.BUY) {
        return pt + pm >= ONE_WAD;
    }
    return pt + pm <= ONE_WAD;
}

/**
 * Build a match plan for a marketable taker against the resting opposite book.
 * Walks best-priced-first resting orders and consumes shares until the taker's
 * remaining is exhausted or the book stops crossing. Only COMPLEMENTARY
 * (opposite-side, same tokenId) fills are planned — the safe, always-valid case.
 */
export function planMatch(book: OrderBook, taker: BookOrder): MatchPlan {
    const resting = book.restingOpposite(taker.tokenId, taker.side);
    const fills: PlannedFill[] = [];

    let takerSharesLeft = remainingShares(taker);
    let totalShares = 0n;

    for (const maker of resting) {
        if (takerSharesLeft <= 0n) break;
        if (maker.hash === taker.hash) continue;
        if (maker.remainingMaker <= 0n) continue;
        // Opposite side, same tokenId only (COMPLEMENTARY).
        if (maker.side === taker.side) continue;
        if (maker.tokenId !== taker.tokenId) continue;
        if (!crosses(taker, maker)) break; // book no longer crosses — stop.

        const makerSharesLeft = remainingShares(maker);
        const shares = takerSharesLeft < makerSharesLeft ? takerSharesLeft : makerSharesLeft;
        if (shares <= 0n) continue;

        const makerFillAmount = sharesToMakerUnits(maker, shares);
        if (makerFillAmount <= 0n) continue;

        fills.push({ maker, shares, makerFillAmount });
        takerSharesLeft -= shares;
        totalShares += shares;
    }

    const takerFillAmount = sharesToMakerUnits(taker, totalShares);
    return { taker, fills, takerFillAmount, totalShares };
}

/** A plan is executable only if it actually crosses something with non-zero fills. */
export function isExecutable(plan: MatchPlan): boolean {
    return plan.fills.length > 0 && plan.takerFillAmount > 0n && plan.totalShares > 0n;
}
