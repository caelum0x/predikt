import { test } from "node:test";
import assert from "node:assert/strict";

import { OrderSide } from "../../src/orders.ts";
import {
    ONE_WAD,
    priceWad,
    calculateTaking,
    calculateFee,
    statusFromRemaining,
} from "../../src/book/order.ts";

test("priceWad BUY = makerAmount*1e18/takerAmount (floor)", () => {
    // BUY 60 USDC for 100 shares → price 0.6e18
    assert.equal(priceWad(OrderSide.BUY, 60n, 100n), (60n * ONE_WAD) / 100n);
    // floor behavior: 1/3 truncates
    assert.equal(priceWad(OrderSide.BUY, 1n, 3n), ONE_WAD / 3n);
});

test("priceWad SELL = takerAmount*1e18/makerAmount (floor)", () => {
    // SELL 100 shares for 60 USDC → price 0.6e18
    assert.equal(priceWad(OrderSide.SELL, 100n, 60n), (60n * ONE_WAD) / 100n);
});

test("priceWad guards zero denominator (no divide-by-zero)", () => {
    assert.equal(priceWad(OrderSide.BUY, 100n, 0n), 0n);
    assert.equal(priceWad(OrderSide.SELL, 0n, 60n), 0n);
});

test("calculateTaking = making*taker/maker with floor rounding", () => {
    // exact
    assert.equal(calculateTaking(100n, 100n, 200n), 200n);
    assert.equal(calculateTaking(50n, 100n, 200n), 100n);
    // floor: 7 * 3 / 10 = 2.1 → 2
    assert.equal(calculateTaking(7n, 10n, 3n), 2n);
    // floor never rounds up: 999 * 1 / 1000 = 0
    assert.equal(calculateTaking(999n, 1000n, 1n), 0n);
});

test("calculateTaking guards zero makerAmount", () => {
    assert.equal(calculateTaking(10n, 0n, 5n), 0n);
});

test("calculateFee returns 0 for zero/negative feeRate", () => {
    assert.equal(calculateFee(0n, 100n, 60n, 100n, OrderSide.BUY), 0n);
    assert.equal(calculateFee(-5n, 100n, 60n, 100n, OrderSide.BUY), 0n);
});

test("calculateFee returns 0 when price out of (0,1e18] band", () => {
    // price 0 (taker 0) → 0
    assert.equal(calculateFee(100n, 100n, 60n, 0n, OrderSide.BUY), 0n);
});

test("calculateFee symmetric around 0.5 for BUY uses min(price, 1-price)", () => {
    // At price 0.5, min(price,1-price)=0.5e18 → fee = bps*0.5e18*tokens/(0.5e18*10000)
    // = bps*tokens/10000. 100 bps on 1000 tokens = 10.
    const fee = calculateFee(100n, 1000n, 50n, 100n, OrderSide.BUY);
    assert.equal(fee, 10n);
});

test("statusFromRemaining classifies OPEN / PARTIAL / FILLED", () => {
    assert.equal(statusFromRemaining(100n, 100n), "OPEN");
    assert.equal(statusFromRemaining(40n, 100n), "PARTIALLY_FILLED");
    assert.equal(statusFromRemaining(0n, 100n), "FILLED");
    // overfilled / negative also FILLED (defensive)
    assert.equal(statusFromRemaining(-1n, 100n), "FILLED");
});
