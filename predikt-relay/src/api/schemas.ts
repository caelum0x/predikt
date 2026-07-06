import { z } from "zod";
import { SignatureType, OrderSide } from "../orders.ts";

// The relay only settles EOA-signed (ECDSA over the order hash) orders; proxy /
// gnosis-safe / 1271 types require on-chain resolution the relay does not do.
// Enforce that at the boundary so a non-EOA order is rejected before any chain
// call. The value equals SignatureType.EOA (0) — asserted here so drift in the
// shared enum surfaces at type-check time rather than silently widening intake.
const EOA_ONLY: SignatureType.EOA = SignatureType.EOA;

// Boundary validation for every inbound payload. All numeric order fields are
// uint256 and arrive as decimal strings; we validate they parse as non-negative
// BigInts to reject injection / malformed input before any chain call.

const uintString = z
    .string()
    .regex(/^\d+$/, "must be a non-negative integer string")
    .refine((v) => {
        try {
            return BigInt(v) >= 0n;
        } catch {
            return false;
        }
    }, "must be a valid uint256");

const address = z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, "must be a 20-byte hex address");

const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "must be a 32-byte hex hash");

export const signedOrderSchema = z.object({
    salt: uintString,
    maker: address,
    signer: address,
    taker: address,
    tokenId: uintString,
    makerAmount: uintString,
    takerAmount: uintString,
    expiration: uintString,
    nonce: uintString,
    feeRateBps: uintString,
    side: z.nativeEnum(OrderSide),
    // EOA only: reject non-ECDSA signature types at the boundary (see EOA_ONLY).
    signatureType: z.literal(EOA_ONLY),
    signature: z.string().regex(/^0x[0-9a-fA-F]+$/, "signature must be hex"),
});

export type SignedOrderInput = z.infer<typeof signedOrderSchema>;

// Authenticated cancel: the maker proves ownership with an EIP-712 "Cancel"
// signature over { orderHash, deadline }. The relay recovers the signer and
// requires it to equal the stored order's maker (see engine.cancelOrder).
export const cancelBodySchema = z.object({
    signature: z.string().regex(/^0x[0-9a-fA-F]+$/, "signature must be hex"),
    deadline: z.coerce
        .number()
        .int("deadline must be an integer unix timestamp")
        .positive("deadline must be positive"),
});

export type CancelBodyInput = z.infer<typeof cancelBodySchema>;

export const bookQuerySchema = z.object({
    tokenId: uintString,
});

export const ordersQuerySchema = z.object({
    maker: address,
    // Optional row cap (1–500); the store clamps this and defaults to 500.
    limit: z.coerce.number().int().positive().max(500).optional(),
});

export const tradesQuerySchema = z.object({
    tokenId: uintString,
});

export { hex32 };
