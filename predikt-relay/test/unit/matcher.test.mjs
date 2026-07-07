import { test } from "node:test";
import assert from "node:assert/strict";

import { OrderSide } from "../../src/orders.ts";
import { OrderBook } from "../../src/book/book.ts";
import {
    planMatch,
    isExecutable,
    crosses,
    remainingShares,
    sharesToMakerUnits,
} from "../../src/book/matcher.ts";
import { makeOrder } from "./helpers.mjs";

// ── remainingShares / sharesToMakerUnits ────────────────────────────────────

test("remainingShares: SELL maker units already are shares", () => {
    const sell = makeOrder({ side: OrderSide.SELL, makerAmount: 100n, takerAmount: 60n });
    assert.equal(remainingShares(sell), 100n);
});

test("remainingShares: BUY converts remaining USDC to shares via taker/maker", () => {
    // BUY 60 USDC (maker) for 100 shares (taker) → 60 USDC = 100 shares
    const buy = makeOrder({ side: OrderSide.BUY, makerAmount: 60n, takerAmount: 100n });
    assert.equal(remainingShares(buy), 100n);
    // partially filled: 30 USDC remaining → 50 shares
    const partial = makeOrder({
        side: OrderSide.BUY,
        makerAmount: 60n,
        takerAmount: 100n,
        remainingMaker: 30n,
    });
    assert.equal(remainingShares(partial), 50n);
});

test("sharesToMakerUnits: SELL is identity, BUY = shares*maker/taker floor", () => {
    const sell = makeOrder({ side: OrderSide.SELL, makerAmount: 100n, takerAmount: 60n });
    assert.equal(sharesToMakerUnits(sell, 40n), 40n);
    const buy = makeOrder({ side: OrderSide.BUY, makerAmount: 60n, takerAmount: 100n });
    // 50 shares → 50*60/100 = 30 USDC
    assert.equal(sharesToMakerUnits(buy, 50n), 30n);
});

test("sharesToMakerUnits: BUY guards zero takerAmount", () => {
    const buy = makeOrder({ side: OrderSide.BUY, makerAmount: 60n, takerAmount: 100n });
    const zeroed = { ...buy, takerAmount: 0n };
    assert.equal(sharesToMakerUnits(zeroed, 50n), 0n);
});

// ── crosses ─────────────────────────────────────────────────────────────────

test("crosses: taker BUY vs maker SELL crosses when bid price >= ask price", () => {
    const buy = makeOrder({ side: OrderSide.BUY, makerAmount: 70n, takerAmount: 100n }); // 0.70
    const sellCheap = makeOrder({ side: OrderSide.SELL, makerAmount: 100n, takerAmount: 60n }); // 0.60
    const sellRich = makeOrder({ side: OrderSide.SELL, makerAmount: 100n, takerAmount: 80n }); // 0.80
    assert.equal(crosses(buy, sellCheap), true);
    assert.equal(crosses(buy, sellRich), false);
});

test("crosses: taker SELL vs maker BUY crosses when bid >= ask", () => {
    const sell = makeOrder({ side: OrderSide.SELL, makerAmount: 100n, takerAmount: 60n }); // 0.60
    const buyRich = makeOrder({ side: OrderSide.BUY, makerAmount: 70n, takerAmount: 100n }); // 0.70
    const buyCheap = makeOrder({ side: OrderSide.BUY, makerAmount: 50n, takerAmount: 100n }); // 0.50
    assert.equal(crosses(sell, buyRich), true);
    assert.equal(crosses(sell, buyCheap), false);
});

test("crosses: exact touch (equal price) crosses", () => {
    const buy = makeOrder({ side: OrderSide.BUY, makerAmount: 60n, takerAmount: 100n }); // 0.60
    const sell = makeOrder({ side: OrderSide.SELL, makerAmount: 100n, takerAmount: 60n }); // 0.60
    assert.equal(crosses(buy, sell), true);
});

// ── planMatch: core scenarios ───────────────────────────────────────────────

test("planMatch: empty book yields no fills / not executable", () => {
    const book = new OrderBook();
    const taker = makeOrder({ side: OrderSide.BUY, makerAmount: 70n, takerAmount: 100n });
    const plan = planMatch(book, taker);
    assert.equal(plan.fills.length, 0);
    assert.equal(plan.totalShares, 0n);
    assert.equal(isExecutable(plan), false);
});

test("planMatch: full complementary fill (taker BUY sweeps one SELL)", () => {
    const book = new OrderBook();
    // resting SELL: 100 shares @ 0.60
    const sell = makeOrder({ side: OrderSide.SELL, makerAmount: 100n, takerAmount: 60n });
    book.add(sell);
    // taker BUY willing to pay 0.70 for 100 shares (60->70 crosses)
    const buy = makeOrder({ side: OrderSide.BUY, makerAmount: 70n, takerAmount: 100n });
    const plan = planMatch(book, buy);
    assert.equal(plan.fills.length, 1);
    assert.equal(plan.fills[0].maker.hash, sell.hash);
    assert.equal(plan.fills[0].shares, 100n);
    // maker (SELL) fill in maker units = shares
    assert.equal(plan.fills[0].makerFillAmount, 100n);
    assert.equal(plan.totalShares, 100n);
    // taker (BUY) fill in USDC = 100 shares * 70/100 = 70
    assert.equal(plan.takerFillAmount, 70n);
    assert.equal(isExecutable(plan), true);
});

test("planMatch: partial fill when taker smaller than resting maker", () => {
    const book = new OrderBook();
    const sell = makeOrder({ side: OrderSide.SELL, makerAmount: 100n, takerAmount: 60n });
    book.add(sell);
    // taker BUY only wants 40 shares (@0.70)
    const buy = makeOrder({ side: OrderSide.BUY, makerAmount: 28n, takerAmount: 40n }); // 0.70
    const plan = planMatch(book, buy);
    assert.equal(plan.fills.length, 1);
    assert.equal(plan.fills[0].shares, 40n);
    assert.equal(plan.totalShares, 40n);
});

test("planMatch: price-time priority — cheapest ask first, then oldest", () => {
    const book = new OrderBook();
    // two asks: rich (0.65) added first, cheap (0.55) added later
    const rich = makeOrder({ side: OrderSide.SELL, makerAmount: 100n, takerAmount: 65n, createdAt: 1 });
    const cheap = makeOrder({ side: OrderSide.SELL, makerAmount: 100n, takerAmount: 55n, createdAt: 2 });
    book.add(rich);
    book.add(cheap);
    // taker BUY 200 shares @ 0.70 sweeps both, cheapest first
    const buy = makeOrder({ side: OrderSide.BUY, makerAmount: 140n, takerAmount: 200n });
    const plan = planMatch(book, buy);
    assert.equal(plan.fills.length, 2);
    assert.equal(plan.fills[0].maker.hash, cheap.hash, "cheapest ask filled first");
    assert.equal(plan.fills[1].maker.hash, rich.hash);
    assert.equal(plan.totalShares, 200n);
});

test("planMatch: time priority breaks price ties (oldest first)", () => {
    const book = new OrderBook();
    const older = makeOrder({ side: OrderSide.SELL, makerAmount: 100n, takerAmount: 60n, createdAt: 1 });
    const newer = makeOrder({ side: OrderSide.SELL, makerAmount: 100n, takerAmount: 60n, createdAt: 2 });
    // add newer first to prove sort, not insertion order, wins
    book.add(newer);
    book.add(older);
    const buy = makeOrder({ side: OrderSide.BUY, makerAmount: 70n, takerAmount: 100n });
    const plan = planMatch(book, buy);
    assert.equal(plan.fills[0].maker.hash, older.hash, "oldest at same price fills first");
});

test("planMatch: stops at first non-crossing ask (walks best-first)", () => {
    const book = new OrderBook();
    const cheap = makeOrder({ side: OrderSide.SELL, makerAmount: 100n, takerAmount: 55n, createdAt: 1 }); // 0.55
    const tooRich = makeOrder({ side: OrderSide.SELL, makerAmount: 100n, takerAmount: 90n, createdAt: 2 }); // 0.90
    book.add(cheap);
    book.add(tooRich);
    // taker BUY @ 0.60 crosses cheap only
    const buy = makeOrder({ side: OrderSide.BUY, makerAmount: 120n, takerAmount: 200n }); // 0.60
    const plan = planMatch(book, buy);
    assert.equal(plan.fills.length, 1);
    assert.equal(plan.fills[0].maker.hash, cheap.hash);
    assert.equal(plan.fills[0].shares, 100n);
});

// ── edge cases: self-cross, same-side, zero-size ────────────────────────────

test("planMatch: never matches an order against itself (self-cross guard)", () => {
    const book = new OrderBook();
    const buy = makeOrder({ side: OrderSide.BUY, makerAmount: 70n, takerAmount: 100n });
    book.add(buy);
    // restingOpposite for BUY returns asks; but assert the guard directly by
    // constructing a taker sharing the maker's hash on the opposite side.
    const selfHash = buy.hash;
    const sell = makeOrder({ side: OrderSide.SELL, makerAmount: 100n, takerAmount: 60n, hash: selfHash });
    book.add(sell);
    const takerSameHash = { ...buy, hash: selfHash };
    const plan = planMatch(book, takerSameHash);
    // The only opposite resting order shares taker's hash → skipped.
    assert.equal(plan.fills.length, 0);
    assert.equal(isExecutable(plan), false);
});

test("planMatch: same-side resting orders are never paired", () => {
    const book = new OrderBook();
    // Two BUY orders; a BUY taker must not match another BUY.
    const restingBuy = makeOrder({ side: OrderSide.BUY, makerAmount: 60n, takerAmount: 100n });
    book.add(restingBuy);
    const takerBuy = makeOrder({ side: OrderSide.BUY, makerAmount: 70n, takerAmount: 100n });
    const plan = planMatch(book, takerBuy);
    assert.equal(plan.fills.length, 0);
});

test("planMatch: different tokenId does not cross", () => {
    const book = new OrderBook();
    const sell = makeOrder({ side: OrderSide.SELL, makerAmount: 100n, takerAmount: 60n, tokenId: "2" });
    book.add(sell);
    const buy = makeOrder({ side: OrderSide.BUY, makerAmount: 70n, takerAmount: 100n, tokenId: "1" });
    const plan = planMatch(book, buy);
    assert.equal(plan.fills.length, 0);
});

test("planMatch: zero-remaining resting order is skipped", () => {
    const book = new OrderBook();
    const sell = makeOrder({
        side: OrderSide.SELL,
        makerAmount: 100n,
        takerAmount: 60n,
        remainingMaker: 0n,
    });
    book.add(sell);
    const buy = makeOrder({ side: OrderSide.BUY, makerAmount: 70n, takerAmount: 100n });
    const plan = planMatch(book, buy);
    assert.equal(plan.fills.length, 0);
});

test("planMatch: taker with zero remaining shares produces no fills", () => {
    const book = new OrderBook();
    const sell = makeOrder({ side: OrderSide.SELL, makerAmount: 100n, takerAmount: 60n });
    book.add(sell);
    const buy = makeOrder({
        side: OrderSide.BUY,
        makerAmount: 70n,
        takerAmount: 100n,
        remainingMaker: 0n,
    });
    const plan = planMatch(book, buy);
    assert.equal(plan.totalShares, 0n);
    assert.equal(isExecutable(plan), false);
});

test("planMatch: partially-filled resting maker only offers its remainder", () => {
    const book = new OrderBook();
    // SELL 100 shares, 30 already filled → 70 remaining shares
    const sell = makeOrder({
        side: OrderSide.SELL,
        makerAmount: 100n,
        takerAmount: 60n,
        remainingMaker: 70n,
    });
    book.add(sell);
    const buy = makeOrder({ side: OrderSide.BUY, makerAmount: 70n, takerAmount: 100n });
    const plan = planMatch(book, buy);
    assert.equal(plan.fills.length, 1);
    assert.equal(plan.fills[0].shares, 70n, "only the maker's remaining shares fill");
    assert.equal(plan.totalShares, 70n);
});

test("isExecutable: false when fills exist but total shares zero", () => {
    // A fabricated plan with an empty fill list is not executable.
    assert.equal(isExecutable({ taker: {}, fills: [], takerFillAmount: 0n, totalShares: 0n }), false);
});
