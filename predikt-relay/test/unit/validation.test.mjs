import { test } from "node:test";
import assert from "node:assert/strict";

import { SignatureType } from "../../src/orders.ts";
import {
    signedOrderSchema,
    cancelBodySchema,
    ordersQuerySchema,
} from "../../src/api/schemas.ts";
import {
    evaluateBuyFunding,
    evaluateSellFunding,
} from "../../src/chain/exchange.ts";
import { signedOrderFixture } from "./helpers.mjs";

// ── signedOrderSchema: EOA-only gate + field validation ─────────────────────

test("signedOrderSchema accepts a well-formed EOA order", () => {
    const res = signedOrderSchema.safeParse(signedOrderFixture());
    assert.equal(res.success, true);
});

test("signedOrderSchema rejects non-EOA signature types (POLY_PROXY / POLY_1271)", () => {
    for (const bad of [1, 2, 3]) {
        const res = signedOrderSchema.safeParse(signedOrderFixture({ signatureType: bad }));
        assert.equal(res.success, false, `signatureType ${bad} must be rejected`);
    }
    // sanity: EOA (0) is the only accepted type
    assert.equal(SignatureType.EOA, 0);
});

test("signedOrderSchema rejects non-integer / negative amount strings", () => {
    assert.equal(
        signedOrderSchema.safeParse(signedOrderFixture({ makerAmount: "-1" })).success,
        false,
    );
    const floaty = { ...signedOrderFixture(), takerAmount: "1.5" };
    assert.equal(signedOrderSchema.safeParse(floaty).success, false);
    const injection = { ...signedOrderFixture(), salt: "1; DROP TABLE orders" };
    assert.equal(signedOrderSchema.safeParse(injection).success, false);
});

test("signedOrderSchema rejects malformed addresses and signatures", () => {
    assert.equal(
        signedOrderSchema.safeParse({ ...signedOrderFixture(), maker: "0xnothex" }).success,
        false,
    );
    assert.equal(
        signedOrderSchema.safeParse({ ...signedOrderFixture(), signature: "not-hex" }).success,
        false,
    );
});

test("signedOrderSchema accepts zero expiration (never-expires sentinel)", () => {
    assert.equal(signedOrderSchema.safeParse(signedOrderFixture()).success, true);
});

// ── cancelBodySchema ────────────────────────────────────────────────────────

test("cancelBodySchema requires hex signature and positive integer deadline", () => {
    assert.equal(
        cancelBodySchema.safeParse({ signature: `0x${"11".repeat(65)}`, deadline: 1_700_000_000 })
            .success,
        true,
    );
    assert.equal(
        cancelBodySchema.safeParse({ signature: "0xbeef", deadline: -1 }).success,
        false,
    );
    assert.equal(
        cancelBodySchema.safeParse({ signature: "nope", deadline: 1 }).success,
        false,
    );
});

// ── ordersQuerySchema: limit cap ────────────────────────────────────────────

test("ordersQuerySchema clamps limit to <=500 and coerces string", () => {
    assert.equal(
        ordersQuerySchema.safeParse({
            maker: "0x000000000000000000000000000000000000dEaD",
            limit: "501",
        }).success,
        false,
        "limit above 500 rejected at boundary",
    );
    const ok = ordersQuerySchema.safeParse({
        maker: "0x000000000000000000000000000000000000dEaD",
        limit: "100",
    });
    assert.equal(ok.success, true);
    assert.equal(ok.data.limit, 100);
});

// ── fund-check branching (pure) ─────────────────────────────────────────────

test("evaluateBuyFunding: BUY needs USDC balance AND allowance to cover making", () => {
    assert.deepEqual(evaluateBuyFunding(100n, 100n, 100n), { ok: true });
    assert.deepEqual(evaluateBuyFunding(100n, 99n, 1_000n), {
        ok: false,
        reason: "insufficient USDC balance",
    });
    assert.deepEqual(evaluateBuyFunding(100n, 1_000n, 99n), {
        ok: false,
        reason: "insufficient USDC allowance",
    });
    // exact-boundary: balance == allowance == making → ok
    assert.deepEqual(evaluateBuyFunding(50n, 50n, 50n), { ok: true });
});

test("evaluateSellFunding: SELL needs approval AND CTF balance; approval checked first", () => {
    assert.deepEqual(evaluateSellFunding(100n, 100n, true), { ok: true });
    // not approved dominates even with enough balance
    assert.deepEqual(evaluateSellFunding(100n, 1_000n, false), {
        ok: false,
        reason: "CTF not approved for exchange",
    });
    assert.deepEqual(evaluateSellFunding(100n, 99n, true), {
        ok: false,
        reason: "insufficient CTF balance",
    });
});
