import { test } from "node:test";
import assert from "node:assert/strict";

import { OrderSide } from "../../src/orders.ts";
import { OrderBook } from "../../src/book/book.ts";
import { makeOrder } from "./helpers.mjs";

test("add/get/has/remove basic lifecycle", () => {
    const book = new OrderBook();
    const o = makeOrder({ side: OrderSide.BUY, makerAmount: 60n, takerAmount: 100n });
    assert.equal(book.has(o.hash), false);
    book.add(o);
    assert.equal(book.has(o.hash), true);
    assert.equal(book.get(o.hash)?.hash, o.hash);
    book.remove(o.hash);
    assert.equal(book.has(o.hash), false);
});

test("add is idempotent on hash (no duplicate resting order)", () => {
    const book = new OrderBook();
    const o = makeOrder({ side: OrderSide.SELL, makerAmount: 100n, takerAmount: 60n });
    book.add(o);
    book.add({ ...o });
    assert.equal(book.snapshot(o.tokenId).asks.length, 1);
});

test("bids sorted price DESC then time ASC", () => {
    const book = new OrderBook();
    const low = makeOrder({ side: OrderSide.BUY, makerAmount: 50n, takerAmount: 100n, createdAt: 1 }); // 0.50
    const highOld = makeOrder({ side: OrderSide.BUY, makerAmount: 70n, takerAmount: 100n, createdAt: 1 }); // 0.70
    const highNew = makeOrder({ side: OrderSide.BUY, makerAmount: 70n, takerAmount: 100n, createdAt: 2 }); // 0.70
    book.add(low);
    book.add(highNew);
    book.add(highOld);
    const bids = book.restingOpposite("1", OrderSide.SELL); // opposite of SELL = bids
    assert.equal(bids[0].hash, highOld.hash, "highest price, oldest first");
    assert.equal(bids[1].hash, highNew.hash);
    assert.equal(bids[2].hash, low.hash);
});

test("asks sorted price ASC then time ASC", () => {
    const book = new OrderBook();
    const rich = makeOrder({ side: OrderSide.SELL, makerAmount: 100n, takerAmount: 80n, createdAt: 1 }); // 0.80
    const cheapOld = makeOrder({ side: OrderSide.SELL, makerAmount: 100n, takerAmount: 55n, createdAt: 1 }); // 0.55
    const cheapNew = makeOrder({ side: OrderSide.SELL, makerAmount: 100n, takerAmount: 55n, createdAt: 2 });
    book.add(rich);
    book.add(cheapNew);
    book.add(cheapOld);
    const asks = book.restingOpposite("1", OrderSide.BUY); // opposite of BUY = asks
    assert.equal(asks[0].hash, cheapOld.hash, "cheapest, oldest first");
    assert.equal(asks[1].hash, cheapNew.hash);
    assert.equal(asks[2].hash, rich.hash);
});

test("restingOpposite returns a copy (mutation-safe)", () => {
    const book = new OrderBook();
    const o = makeOrder({ side: OrderSide.SELL, makerAmount: 100n, takerAmount: 60n });
    book.add(o);
    const list = book.restingOpposite("1", OrderSide.BUY);
    list.pop();
    assert.equal(book.restingOpposite("1", OrderSide.BUY).length, 1, "internal book untouched");
});

test("snapshot excludes zero-remaining orders", () => {
    const book = new OrderBook();
    const live = makeOrder({ side: OrderSide.BUY, makerAmount: 60n, takerAmount: 100n });
    const drained = makeOrder({
        side: OrderSide.BUY,
        makerAmount: 60n,
        takerAmount: 100n,
        remainingMaker: 0n,
    });
    book.add(live);
    book.add(drained);
    const snap = book.snapshot("1");
    assert.equal(snap.bids.length, 1);
    assert.equal(snap.bids[0].hash, live.hash);
});

test("refresh evicts FILLED / CANCELLED / drained orders", () => {
    const book = new OrderBook();
    const open = makeOrder({ side: OrderSide.BUY, makerAmount: 60n, takerAmount: 100n });
    const filled = makeOrder({ side: OrderSide.BUY, makerAmount: 60n, takerAmount: 100n });
    filled.status = "FILLED";
    filled.remainingMaker = 0n;
    book.add(open);
    book.add(filled);
    book.refresh("1");
    assert.equal(book.has(filled.hash), false);
    assert.equal(book.has(open.hash), true);
});

test("empty book snapshot / restingOpposite for unknown token", () => {
    const book = new OrderBook();
    assert.deepEqual(book.snapshot("999"), { bids: [], asks: [] });
    assert.deepEqual(book.restingOpposite("999", OrderSide.BUY), []);
});
