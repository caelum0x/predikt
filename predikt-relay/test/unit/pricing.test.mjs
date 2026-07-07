import { test } from "node:test";
import assert from "node:assert/strict";

import {
    MIN_PRICE,
    MAX_PRICE,
    clampPrice,
    wadToProb,
    midFromBook,
    buildLadder,
} from "../../src/marketmaker/pricing.ts";

const ONE_WAD = 10n ** 18n;
const wad = (p) => ((BigInt(Math.round(p * 1e6)) * ONE_WAD) / 1_000_000n).toString();

// ── clampPrice ──────────────────────────────────────────────────────────────

test("clampPrice bounds to [MIN_PRICE, MAX_PRICE]", () => {
    assert.equal(clampPrice(0), MIN_PRICE);
    assert.equal(clampPrice(1), MAX_PRICE);
    assert.equal(clampPrice(-5), MIN_PRICE);
    assert.equal(clampPrice(5), MAX_PRICE);
    assert.equal(clampPrice(0.5), 0.5);
});

test("clampPrice: non-finite (NaN / Infinity) falls back to 0.5", () => {
    // Number.isFinite is false for NaN and both infinities, so all map to 0.5.
    assert.equal(clampPrice(NaN), 0.5);
    assert.equal(clampPrice(Infinity), 0.5);
    assert.equal(clampPrice(Number.NEGATIVE_INFINITY), 0.5);
});

// ── wadToProb ───────────────────────────────────────────────────────────────

test("wadToProb converts fixed-point wad to 0..1 probability", () => {
    assert.equal(wadToProb(wad(0.6)), 0.6);
    assert.equal(wadToProb((ONE_WAD / 2n).toString()), 0.5);
    assert.equal(wadToProb("0"), 0);
});

// ── midFromBook ─────────────────────────────────────────────────────────────

test("midFromBook: mid of best bid and best ask", () => {
    const book = { tokenId: "1", bids: [{ priceWad: wad(0.4) }], asks: [{ priceWad: wad(0.6) }] };
    assert.equal(midFromBook(book), 0.5);
});

test("midFromBook: one-sided book uses the present side (clamped)", () => {
    assert.equal(midFromBook({ tokenId: "1", bids: [{ priceWad: wad(0.7) }], asks: [] }), 0.7);
    assert.equal(midFromBook({ tokenId: "1", bids: [], asks: [{ priceWad: wad(0.3) }] }), 0.3);
});

test("midFromBook: empty book returns undefined (caller falls back)", () => {
    assert.equal(midFromBook({ tokenId: "1", bids: [], asks: [] }), undefined);
});

test("midFromBook: rail-hugging mid is clamped into band", () => {
    const book = { tokenId: "1", bids: [{ priceWad: wad(0.001) }], asks: [{ priceWad: wad(0.002) }] };
    const mid = midFromBook(book);
    assert.ok(mid >= MIN_PRICE && mid <= MAX_PRICE);
});

// ── buildLadder: spacing / sizing / levels ──────────────────────────────────

test("buildLadder: symmetric BUY/SELL around mid with correct step spacing", () => {
    // spread 100 bps = 0.01 step; 2 levels; mid 0.5
    const ladder = buildLadder(0.5, 100, 2, 10);
    const buys = ladder.filter((l) => l.side === "BUY").map((l) => l.price);
    const sells = ladder.filter((l) => l.side === "SELL").map((l) => l.price);
    assert.equal(buys.length, 2);
    assert.equal(sells.length, 2);
    // innermost level is half a step off mid: 0.5 - 0.005 = 0.495
    assert.ok(Math.abs(buys[0] - 0.495) < 1e-9);
    assert.ok(Math.abs(sells[0] - 0.505) < 1e-9);
    // second level: 1.5 steps off → 0.5 -/+ 0.015
    assert.ok(Math.abs(buys[1] - 0.485) < 1e-9);
    assert.ok(Math.abs(sells[1] - 0.515) < 1e-9);
});

test("buildLadder: every level carries the requested order size", () => {
    const ladder = buildLadder(0.5, 50, 3, 42);
    assert.ok(ladder.length > 0);
    for (const l of ladder) assert.equal(l.size, 42);
});

test("buildLadder: level count honored (up to 2 orders per level)", () => {
    const ladder = buildLadder(0.5, 100, 4, 10);
    // 4 levels, both sides quotable near mid → 8 orders
    assert.equal(ladder.length, 8);
});

test("buildLadder: levels colliding with the rail are dropped (BUY side near 0)", () => {
    // mid near MIN rail: BUY levels clamp onto MIN_PRICE and get dropped, SELL survive
    const ladder = buildLadder(0.02, 300, 3, 10);
    const buys = ladder.filter((l) => l.side === "BUY");
    // buyPrice must be strictly > MIN_PRICE and < mid; deep levels collapse
    for (const b of buys) assert.ok(b.price > MIN_PRICE && b.price < 0.02);
});

test("buildLadder: prices never exceed the trading band", () => {
    const ladder = buildLadder(0.5, 5000, 10, 10); // huge spread pushes toward rails
    for (const l of ladder) {
        assert.ok(l.price >= MIN_PRICE && l.price <= MAX_PRICE);
    }
});

// ── buildLadder: hardened invalid inputs ────────────────────────────────────

test("buildLadder: NaN mid clamps to 0.5 and still produces a ladder", () => {
    const ladder = buildLadder(NaN, 100, 2, 10);
    // clamped mid 0.5 → symmetric quotes
    assert.equal(ladder.length, 4);
});

test("buildLadder: non-positive spread yields empty ladder", () => {
    assert.deepEqual(buildLadder(0.5, 0, 3, 10), []);
    assert.deepEqual(buildLadder(0.5, -100, 3, 10), []);
    assert.deepEqual(buildLadder(0.5, NaN, 3, 10), []);
});

test("buildLadder: non-positive size yields empty ladder (no zero-size quotes)", () => {
    assert.deepEqual(buildLadder(0.5, 100, 3, 0), []);
    assert.deepEqual(buildLadder(0.5, 100, 3, -5), []);
});

test("buildLadder: non-positive / non-finite levels yields empty ladder", () => {
    assert.deepEqual(buildLadder(0.5, 100, 0, 10), []);
    assert.deepEqual(buildLadder(0.5, 100, -3, 10), []);
    assert.deepEqual(buildLadder(0.5, 100, NaN, 10), []);
});

test("buildLadder: fractional level count is floored", () => {
    const ladder = buildLadder(0.5, 100, 2.9, 10);
    // floor(2.9) = 2 levels → 4 orders
    assert.equal(ladder.length, 4);
});
