import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { OrderSide } from "../../src/orders.ts";
import { RelayStore } from "../../src/store/db.ts";
import { makeOrder, signedOrderFixture } from "./helpers.mjs";

function freshStore() {
    const dir = mkdtempSync(join(tmpdir(), "predikt-relay-db-"));
    const store = new RelayStore(join(dir, "relay.db"));
    return {
        store,
        cleanup() {
            store.close();
            rmSync(dir, { recursive: true, force: true });
        },
    };
}

test("upsertOrder → getOrder round-trips all fields including bigints", () => {
    const { store, cleanup } = freshStore();
    try {
        const o = makeOrder({ side: OrderSide.SELL, makerAmount: 123456789n, takerAmount: 987654321n });
        store.upsertOrder(o);
        const back = store.getOrder(o.hash);
        assert.ok(back);
        assert.equal(back.hash, o.hash);
        assert.equal(back.tokenId, o.tokenId);
        assert.equal(back.side, o.side);
        assert.equal(back.makerAmount, o.makerAmount);
        assert.equal(back.takerAmount, o.takerAmount);
        assert.equal(back.remainingMaker, o.remainingMaker);
        assert.equal(back.priceWad, o.priceWad);
        assert.equal(back.status, o.status);
        assert.equal(back.createdAt, o.createdAt);
        // signed order JSON preserved
        assert.equal(back.order.maker, o.order.maker);
        assert.equal(back.order.signatureType, o.order.signatureType);
    } finally {
        cleanup();
    }
});

test("upsertOrder preserves huge uint256 amounts (no INTEGER truncation)", () => {
    const { store, cleanup } = freshStore();
    try {
        const big = (2n ** 255n) - 1n;
        const o = makeOrder({ side: OrderSide.BUY, makerAmount: big, takerAmount: big + 1n });
        store.upsertOrder(o);
        const back = store.getOrder(o.hash);
        assert.equal(back.makerAmount, big);
        assert.equal(back.takerAmount, big + 1n);
    } finally {
        cleanup();
    }
});

test("upsertOrder ON CONFLICT updates progress (remaining/status) only", () => {
    const { store, cleanup } = freshStore();
    try {
        const o = makeOrder({ side: OrderSide.SELL, makerAmount: 100n, takerAmount: 60n });
        store.upsertOrder(o);
        store.updateOrderProgress(o.hash, 40n, "PARTIALLY_FILLED", o.updatedAt + 5);
        const back = store.getOrder(o.hash);
        assert.equal(back.remainingMaker, 40n);
        assert.equal(back.status, "PARTIALLY_FILLED");
        // makerAmount unchanged
        assert.equal(back.makerAmount, 100n);
    } finally {
        cleanup();
    }
});

test("listActiveOrders returns only OPEN / PARTIALLY_FILLED", () => {
    const { store, cleanup } = freshStore();
    try {
        const open = makeOrder({ side: OrderSide.BUY, makerAmount: 60n, takerAmount: 100n });
        const filled = makeOrder({ side: OrderSide.BUY, makerAmount: 60n, takerAmount: 100n });
        filled.status = "FILLED";
        filled.remainingMaker = 0n;
        const cancelled = makeOrder({ side: OrderSide.SELL, makerAmount: 100n, takerAmount: 60n });
        cancelled.status = "CANCELLED";
        store.upsertOrder(open);
        store.upsertOrder(filled);
        store.upsertOrder(cancelled);
        const active = store.listActiveOrders();
        const hashes = active.map((a) => a.hash);
        assert.ok(hashes.includes(open.hash));
        assert.ok(!hashes.includes(filled.hash));
        assert.ok(!hashes.includes(cancelled.hash));
    } finally {
        cleanup();
    }
});

test("listOrdersByMaker caps rows at 500 and orders newest-first", () => {
    const { store, cleanup } = freshStore();
    try {
        const maker = "0x00000000000000000000000000000000000000aa";
        for (let i = 0; i < 520; i++) {
            const o = makeOrder({
                side: OrderSide.BUY,
                makerAmount: 60n,
                takerAmount: 100n,
                maker,
                createdAt: 1_000 + i,
            });
            store.upsertOrder(o);
        }
        const capped = store.listOrdersByMaker(maker, 10_000);
        assert.equal(capped.length, 500, "hard cap at 500 rows");
        // newest first
        assert.ok(capped[0].createdAt >= capped[capped.length - 1].createdAt);
        // explicit smaller limit honored
        assert.equal(store.listOrdersByMaker(maker, 5).length, 5);
        // limit floor is 1 (0/negative clamps up)
        assert.equal(store.listOrdersByMaker(maker, 0).length, 1);
    } finally {
        cleanup();
    }
});

test("listOrdersByMaker matches maker case-insensitively (stored lowercased)", () => {
    const { store, cleanup } = freshStore();
    try {
        const maker = "0x00000000000000000000000000000000000000AB";
        store.upsertOrder(makeOrder({ side: OrderSide.BUY, makerAmount: 60n, takerAmount: 100n, maker }));
        assert.equal(store.listOrdersByMaker(maker.toLowerCase()).length, 1);
        assert.equal(store.listOrdersByMaker(maker.toUpperCase()).length, 1);
    } finally {
        cleanup();
    }
});

test("rehydration schema validation: corrupt order_json fails loudly", () => {
    const { store, cleanup } = freshStore();
    try {
        const o = makeOrder({ side: OrderSide.BUY, makerAmount: 60n, takerAmount: 100n });
        store.upsertOrder(o);
        // Corrupt the persisted JSON directly, then force a re-read.
        store.db.prepare("UPDATE orders SET order_json = ? WHERE hash = ?")
            .run(JSON.stringify({ maker: "0xnothex" }), o.hash);
        assert.throws(() => store.getOrder(o.hash), /corrupt order row/);
    } finally {
        cleanup();
    }
});

test("insertTrade is idempotent on (tx_hash, log_index)", () => {
    const { store, cleanup } = freshStore();
    try {
        const trade = {
            txHash: `0x${"11".repeat(32)}`,
            logIndex: 0,
            orderHash: `0x${"22".repeat(32)}`,
            tokenId: "1",
            maker: "0x00000000000000000000000000000000000000aa",
            taker: "0x00000000000000000000000000000000000000bb",
            makerAmountFilled: "100",
            takerAmountFilled: "60",
            fee: "0",
            kind: "MATCH",
            blockNumber: "123",
            createdAt: 1_000,
        };
        assert.equal(store.insertTrade(trade), true, "first insert applied");
        assert.equal(store.insertTrade(trade), false, "duplicate ignored (idempotent)");
        const rows = store.listTradesByToken("1");
        assert.equal(rows.length, 1);
        assert.equal(rows[0].makerAmountFilled, "100");
    } finally {
        cleanup();
    }
});

test("meta cursor set/get round-trip", () => {
    const { store, cleanup } = freshStore();
    try {
        assert.equal(store.getMeta("cursor"), undefined);
        store.setMeta("cursor", "42");
        assert.equal(store.getMeta("cursor"), "42");
        store.setMeta("cursor", "99");
        assert.equal(store.getMeta("cursor"), "99");
    } finally {
        cleanup();
    }
});
