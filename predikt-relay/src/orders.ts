// Relay-local binding to the Predikt @predikt/orders SDK.
//
// TYPES come straight from @predikt/orders (the SDK is the single source of
// truth for the order shape + EIP-712 structure — see
// predikt-contracts/clob-client). We re-export them so the whole relay imports
// order types from one place.
//
// The two ENUM VALUES (OrderSide / SignatureType) are re-declared here as
// runtime constants instead of imported, because the SDK's value-exporting
// entrypoint pulls in its viem-based order builder, and Node ESM resolves that
// through the package's realpath (the clob-client dir) where viem is not
// installed. These numeric encodings are load-bearing on-chain constants
// (OrderStructs.sol Side / SignatureType) and MUST match the contract + SDK.

export type {
    Order,
    OrderData,
    OrderHash,
    OrderSignature,
    SignedOrder,
} from "@predikt/orders";

// SignatureType is imported straight from @predikt/orders so there is a SINGLE
// SOURCE OF TRUTH for the signature-type encoding (including POLY_1271=3). The
// SDK's value-exporting entrypoint resolves to its built `dist/index.js`, whose
// transitive viem dependency is satisfied from the SDK's own node_modules, so
// importing this runtime value is safe under both `tsc` and Node type-stripping.
export { SignatureType } from "@predikt/orders";
export { signCancel, cancelDomain, CANCEL_TYPES, CANCEL_PRIMARY_TYPE } from "@predikt/orders";
export type { CancelMessage } from "@predikt/orders";

// NOTE: OrderSide is modelled as a `const` object rather than a TS `enum` so the
// module is erasable-only TypeScript — it runs unchanged under Node's native type
// stripping (`--experimental-strip-types`) as well as `tsc`. The numeric values
// are load-bearing on-chain constants and MUST match the contract + SDK.

/** Mirrors OrderStructs.sol `Side` and the SDK's `Side`/`OrderSide`. */
export const OrderSide = {
    BUY: 0,
    SELL: 1,
} as const;
export type OrderSide = (typeof OrderSide)[keyof typeof OrderSide];
