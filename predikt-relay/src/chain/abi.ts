// Minimal viem-typed ABI fragments for the Predikt on-chain layer.
// Sourced from predikt-contracts/ctf-exchange (CTFExchange) — only the members
// the relay actually calls or listens to. Keeping this narrow avoids vendoring
// the full artifact JSON (disk-conscious) while staying byte-compatible with
// the deployed selectors/topics.

import type { Abi } from "viem";

// The EIP-712 Order struct as encoded on-chain (OrderStructs.sol). Field order
// is load-bearing: it must match the struct + ORDER_TYPEHASH exactly.
export const ORDER_STRUCT_ABI = {
    name: "order",
    type: "tuple",
    components: [
        { name: "salt", type: "uint256" },
        { name: "maker", type: "address" },
        { name: "signer", type: "address" },
        { name: "taker", type: "address" },
        { name: "tokenId", type: "uint256" },
        { name: "makerAmount", type: "uint256" },
        { name: "takerAmount", type: "uint256" },
        { name: "expiration", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "feeRateBps", type: "uint256" },
        { name: "side", type: "uint8" },
        { name: "signatureType", type: "uint8" },
        { name: "signature", type: "bytes" },
    ],
} as const;

export const EXCHANGE_ABI = [
    // ── Trading (operator-gated) ──────────────────────────────────────────
    {
        type: "function",
        name: "fillOrder",
        stateMutability: "nonpayable",
        inputs: [ORDER_STRUCT_ABI, { name: "fillAmount", type: "uint256" }],
        outputs: [],
    },
    {
        type: "function",
        name: "fillOrders",
        stateMutability: "nonpayable",
        inputs: [
            { ...ORDER_STRUCT_ABI, name: "orders", type: "tuple[]" },
            { name: "fillAmounts", type: "uint256[]" },
        ],
        outputs: [],
    },
    {
        type: "function",
        name: "matchOrders",
        stateMutability: "nonpayable",
        inputs: [
            ORDER_STRUCT_ABI,
            { ...ORDER_STRUCT_ABI, name: "makerOrders", type: "tuple[]" },
            { name: "takerFillAmount", type: "uint256" },
            { name: "makerFillAmounts", type: "uint256[]" },
        ],
        outputs: [],
    },
    // ── Views ─────────────────────────────────────────────────────────────
    {
        type: "function",
        name: "getOrderStatus",
        stateMutability: "view",
        inputs: [{ name: "orderHash", type: "bytes32" }],
        outputs: [
            {
                name: "",
                type: "tuple",
                components: [
                    { name: "isFilledOrCancelled", type: "bool" },
                    { name: "remaining", type: "uint256" },
                ],
            },
        ],
    },
    {
        type: "function",
        name: "isValidNonce",
        stateMutability: "view",
        inputs: [
            { name: "usr", type: "address" },
            { name: "nonce", type: "uint256" },
        ],
        outputs: [{ name: "", type: "bool" }],
    },
    {
        type: "function",
        name: "validateTokenId",
        stateMutability: "view",
        inputs: [{ name: "tokenId", type: "uint256" }],
        outputs: [],
    },
    {
        type: "function",
        name: "getComplement",
        stateMutability: "view",
        inputs: [{ name: "token", type: "uint256" }],
        outputs: [{ name: "", type: "uint256" }],
    },
    {
        type: "function",
        name: "getConditionId",
        stateMutability: "view",
        inputs: [{ name: "token", type: "uint256" }],
        outputs: [{ name: "", type: "bytes32" }],
    },
    // ── Events ────────────────────────────────────────────────────────────
    {
        type: "event",
        name: "OrderFilled",
        inputs: [
            { name: "orderHash", type: "bytes32", indexed: true },
            { name: "maker", type: "address", indexed: true },
            { name: "taker", type: "address", indexed: true },
            { name: "makerAssetId", type: "uint256", indexed: false },
            { name: "takerAssetId", type: "uint256", indexed: false },
            { name: "makerAmountFilled", type: "uint256", indexed: false },
            { name: "takerAmountFilled", type: "uint256", indexed: false },
            { name: "fee", type: "uint256", indexed: false },
        ],
    },
    {
        type: "event",
        name: "OrdersMatched",
        inputs: [
            { name: "takerOrderHash", type: "bytes32", indexed: true },
            { name: "takerOrderMaker", type: "address", indexed: true },
            { name: "makerAssetId", type: "uint256", indexed: false },
            { name: "takerAssetId", type: "uint256", indexed: false },
            { name: "makerAmountFilled", type: "uint256", indexed: false },
            { name: "takerAmountFilled", type: "uint256", indexed: false },
        ],
    },
    {
        type: "event",
        name: "OrderCancelled",
        inputs: [{ name: "orderHash", type: "bytes32", indexed: true }],
    },
] as const satisfies Abi;

export const ERC20_ABI = [
    {
        type: "function",
        name: "balanceOf",
        stateMutability: "view",
        inputs: [{ name: "account", type: "address" }],
        outputs: [{ name: "", type: "uint256" }],
    },
    {
        type: "function",
        name: "allowance",
        stateMutability: "view",
        inputs: [
            { name: "owner", type: "address" },
            { name: "spender", type: "address" },
        ],
        outputs: [{ name: "", type: "uint256" }],
    },
] as const satisfies Abi;

export const ERC1155_ABI = [
    {
        type: "function",
        name: "balanceOf",
        stateMutability: "view",
        inputs: [
            { name: "account", type: "address" },
            { name: "id", type: "uint256" },
        ],
        outputs: [{ name: "", type: "uint256" }],
    },
    {
        type: "function",
        name: "isApprovedForAll",
        stateMutability: "view",
        inputs: [
            { name: "account", type: "address" },
            { name: "operator", type: "address" },
        ],
        outputs: [{ name: "", type: "bool" }],
    },
] as const satisfies Abi;
