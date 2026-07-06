import type { RelayBook } from "./relay-client.ts";

const ONE_WAD = 10n ** 18n;
const WAD_SCALE = 1e18;

// Fair mid, clamped to a sane trading band so we never quote at the 0/1 rails
// (orders there can't sit on both sides and are rejected by the SDK rounding).
export const MIN_PRICE = 0.01;
export const MAX_PRICE = 0.99;

export function clampPrice(p: number): number {
    if (!Number.isFinite(p)) return 0.5;
    return Math.min(MAX_PRICE, Math.max(MIN_PRICE, p));
}

/**
 * Convert a relay priceWad to a 0..1 probability. Because collateral and
 * outcome tokens share the same decimals in this deployment, priceWad is a
 * clean 1e18 fixed-point USDC-per-share value, so dividing by 1e18 yields the
 * probability directly.
 */
export function wadToProb(priceWad: string): number {
    const wad = BigInt(priceWad);
    return Number((wad * 10_000n) / ONE_WAD) / 10_000;
}

/**
 * Derive a fair mid for one outcome token from the resting relay book:
 * the mid of the best bid and best ask when both exist, else whichever side
 * exists, else undefined (caller falls back to the oracle probability / 0.5).
 * Bids are sorted best (highest) first and asks best (lowest) first by the
 * relay's snapshot.
 */
export function midFromBook(book: RelayBook): number | undefined {
    const bestBid = book.bids[0] ? wadToProb(book.bids[0].priceWad) : undefined;
    const bestAsk = book.asks[0] ? wadToProb(book.asks[0].priceWad) : undefined;
    if (bestBid !== undefined && bestAsk !== undefined) {
        return clampPrice((bestBid + bestAsk) / 2);
    }
    if (bestBid !== undefined) return clampPrice(bestBid);
    if (bestAsk !== undefined) return clampPrice(bestAsk);
    return undefined;
}

export interface Level {
    side: "BUY" | "SELL";
    /** Limit price as a 0..1 probability (USDC-per-share). */
    price: number;
    /** Order size in whole shares/USDC-notional units passed to the SDK. */
    size: number;
}

/**
 * Build a symmetric BUY/SELL ladder `levels` deep around `mid`, stepping
 * `spreadBps` (basis points of the 0..1 probability) per level. Level i BUY
 * sits below mid and SELL above; the innermost level is half a step off mid so
 * the two sides don't collide at mid. Prices are clamped to the trading band;
 * any level that collapses onto the rail is dropped.
 */
export function buildLadder(
    mid: number,
    spreadBps: number,
    levels: number,
    orderSize: number,
): Level[] {
    const step = spreadBps / 10_000; // bps of probability → absolute prob delta
    const out: Level[] = [];
    for (let i = 0; i < levels; i++) {
        const offset = step * (i + 0.5);
        const buyPrice = clampPrice(mid - offset);
        const sellPrice = clampPrice(mid + offset);
        if (buyPrice > MIN_PRICE && buyPrice < mid) {
            out.push({ side: "BUY", price: buyPrice, size: orderSize });
        }
        if (sellPrice < MAX_PRICE && sellPrice > mid) {
            out.push({ side: "SELL", price: sellPrice, size: orderSize });
        }
    }
    return out;
}

export { WAD_SCALE };
