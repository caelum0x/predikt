// @predikt/orders — Predikt's on-chain order SDK.
// Builds and EIP-712 signs orders for the Predikt CTF Exchange.
// The hosted-CLOB HTTP client that shipped with the upstream package has been
// trimmed; this package is the order-construction + signing core only.
export * from "./config.ts";
export * from "./errors.ts";
export * from "./order-builder/index.ts";
export type {
    EIP712Object,
    EIP712ObjectValue,
    EIP712Parameter,
    EIP712TypedData,
    EIP712Types,
    Order,
    OrderData,
    OrderHash,
    OrderSignature,
    SignedOrder,
} from "./order-utils/index.ts";
export { ExchangeOrderBuilder, Side as OrderSide, SignatureType } from "./order-utils/index.ts";
export type { CancelMessage } from "./order-utils/index.ts";
export {
    CANCEL_DOMAIN_NAME,
    CANCEL_DOMAIN_VERSION,
    CANCEL_PRIMARY_TYPE,
    CANCEL_TYPES,
    cancelDomain,
    signCancel,
} from "./order-utils/index.ts";
export type { ClobSigner } from "./signer.ts";
export * from "./types.ts";
