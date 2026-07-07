// Shared fixtures for the relay unit tests. Kept dependency-free (node:test).
// A BookOrder here is the exact shape src/book/order.ts declares; we build them
// from raw amounts so tests exercise the real price/crossing/fill math.

import { OrderSide } from "../../src/orders.ts";
import { priceWad, statusFromRemaining } from "../../src/book/order.ts";

let seq = 0;

/**
 * Build a BookOrder from human-readable amounts. `makerAmount`/`takerAmount` are
 * the raw uint256 values (bigint) exactly as they would be signed on-chain, so
 * the derived priceWad/status come from the real production functions.
 */
export function makeOrder({
    side,
    makerAmount,
    takerAmount,
    tokenId = "1",
    maker = "0x000000000000000000000000000000000000dEaD",
    remainingMaker,
    createdAt,
    hash,
}) {
    const ma = BigInt(makerAmount);
    const ta = BigInt(takerAmount);
    const rem = remainingMaker === undefined ? ma : BigInt(remainingMaker);
    const idx = seq++;
    return {
        hash: hash ?? `0x${idx.toString(16).padStart(64, "0")}`,
        order: signedOrderFixture({ side, makerAmount: ma, takerAmount: ta, tokenId, maker }),
        tokenId,
        side,
        makerAmount: ma,
        takerAmount: ta,
        remainingMaker: rem,
        status: statusFromRemaining(rem, ma),
        priceWad: priceWad(side, ma, ta),
        createdAt: createdAt ?? 1_000 + idx,
        updatedAt: createdAt ?? 1_000 + idx,
    };
}

/**
 * A structurally-valid SignedOrder (passes signedOrderSchema). The signature is a
 * syntactically-valid 65-byte hex blob — it is NOT a real ECDSA signature and is
 * never verified here; the crypto verification path is covered on-chain, not in
 * these pure-logic unit tests.
 */
export function signedOrderFixture({
    side = OrderSide.BUY,
    makerAmount = 100n,
    takerAmount = 200n,
    tokenId = "1",
    maker = "0x000000000000000000000000000000000000dEaD",
    signatureType = 0,
} = {}) {
    return {
        salt: "12345",
        maker,
        signer: maker,
        taker: "0x0000000000000000000000000000000000000000",
        tokenId,
        makerAmount: makerAmount.toString(),
        takerAmount: takerAmount.toString(),
        expiration: "0",
        nonce: "0",
        feeRateBps: "0",
        side,
        signatureType,
        signature: `0x${"ab".repeat(65)}`,
    };
}

export { OrderSide };
