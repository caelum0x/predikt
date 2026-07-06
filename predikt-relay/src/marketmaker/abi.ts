import type { Abi } from "viem";

// ABI fragments the market maker needs beyond the relay's read-only set: the
// ERC20 approve, the ERC1155 setApprovalForAll, and the ConditionalTokens
// splitPosition used to mint outcome-token sets so the maker can quote SELL.
// Only the members actually called are declared (disk-conscious).

export const ERC20_MM_ABI = [
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
    {
        type: "function",
        name: "approve",
        stateMutability: "nonpayable",
        inputs: [
            { name: "spender", type: "address" },
            { name: "amount", type: "uint256" },
        ],
        outputs: [{ name: "", type: "bool" }],
    },
] as const satisfies Abi;

export const ERC1155_MM_ABI = [
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
    {
        type: "function",
        name: "setApprovalForAll",
        stateMutability: "nonpayable",
        inputs: [
            { name: "operator", type: "address" },
            { name: "approved", type: "bool" },
        ],
        outputs: [],
    },
] as const satisfies Abi;

// Exchange views used to resolve a token's condition + complement so the MM can
// derive the YES/NO pair and the parent conditionId for splitPosition.
export const EXCHANGE_VIEW_ABI = [
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
] as const satisfies Abi;

// ConditionalTokens.splitPosition: mint a full set of outcome tokens by locking
// `amount` collateral. With a binary condition and partition [1, 2] this yields
// equal amounts of the YES and NO tokens, redeemable back to `amount` collateral.
export const CTF_SPLIT_ABI = [
    {
        type: "function",
        name: "splitPosition",
        stateMutability: "nonpayable",
        inputs: [
            { name: "collateralToken", type: "address" },
            { name: "parentCollectionId", type: "bytes32" },
            { name: "conditionId", type: "bytes32" },
            { name: "partition", type: "uint256[]" },
            { name: "amount", type: "uint256" },
        ],
        outputs: [],
    },
] as const satisfies Abi;
