import { OrderSide } from "../orders.ts";
import type { BookOrder } from "./order.ts";

// Per-token order book with price-time-priority ordering.
//   Bids (BUY):  sorted by price DESC (highest willingness to pay first),
//                ties broken by createdAt ASC (oldest first).
//   Asks (SELL): sorted by price ASC (cheapest first), ties by createdAt ASC.
// Only OPEN / PARTIALLY_FILLED orders live here; filled/cancelled are evicted.

export class OrderBook {
    // tokenId -> side -> orders (kept sorted lazily via getters)
    private readonly byToken = new Map<string, { bids: BookOrder[]; asks: BookOrder[] }>();
    private readonly byHash = new Map<string, BookOrder>();

    private bucket(tokenId: string) {
        let b = this.byToken.get(tokenId);
        if (!b) {
            b = { bids: [], asks: [] };
            this.byToken.set(tokenId, b);
        }
        return b;
    }

    has(hash: string): boolean {
        return this.byHash.has(hash);
    }

    get(hash: string): BookOrder | undefined {
        return this.byHash.get(hash);
    }

    add(o: BookOrder): void {
        if (this.byHash.has(o.hash)) return;
        this.byHash.set(o.hash, o);
        const b = this.bucket(o.tokenId);
        const list = o.side === OrderSide.BUY ? b.bids : b.asks;
        list.push(o);
        this.sort(o.tokenId);
    }

    remove(hash: string): void {
        const o = this.byHash.get(hash);
        if (!o) return;
        this.byHash.delete(hash);
        const b = this.byToken.get(o.tokenId);
        if (!b) return;
        b.bids = b.bids.filter((x) => x.hash !== hash);
        b.asks = b.asks.filter((x) => x.hash !== hash);
    }

    /** Re-sort after a mutation (fill drains remaining; cancel/fill removes). */
    private sort(tokenId: string): void {
        const b = this.byToken.get(tokenId);
        if (!b) return;
        b.bids.sort((x, y) =>
            x.priceWad === y.priceWad ? x.createdAt - y.createdAt : y.priceWad < x.priceWad ? -1 : 1,
        );
        b.asks.sort((x, y) =>
            x.priceWad === y.priceWad ? x.createdAt - y.createdAt : x.priceWad < y.priceWad ? -1 : 1,
        );
    }

    /** Resting orders on the opposite side of `side`, best-priced first. */
    restingOpposite(tokenId: string, side: OrderSide): BookOrder[] {
        const b = this.byToken.get(tokenId);
        if (!b) return [];
        return side === OrderSide.BUY ? [...b.asks] : [...b.bids];
    }

    /** Public book snapshot: aggregated levels for bids and asks. */
    snapshot(tokenId: string): { bids: BookOrder[]; asks: BookOrder[] } {
        const b = this.byToken.get(tokenId);
        if (!b) return { bids: [], asks: [] };
        return {
            bids: b.bids.filter((o) => o.remainingMaker > 0n),
            asks: b.asks.filter((o) => o.remainingMaker > 0n),
        };
    }

    /** After a fill, refresh sort order (remaining changed) and evict dead orders. */
    refresh(tokenId: string): void {
        const b = this.byToken.get(tokenId);
        if (!b) return;
        for (const o of [...b.bids, ...b.asks]) {
            if (o.status === "FILLED" || o.status === "CANCELLED" || o.remainingMaker <= 0n) {
                this.remove(o.hash);
            }
        }
        this.sort(tokenId);
    }
}
