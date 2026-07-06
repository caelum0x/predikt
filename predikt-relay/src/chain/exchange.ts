import {
    createPublicClient,
    createWalletClient,
    hashTypedData,
    http,
    verifyTypedData,
    type Account,
    type Hex,
    type PublicClient,
    type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { SignedOrder } from "@predikt/orders";
import { cancelDomain, CANCEL_TYPES, CANCEL_PRIMARY_TYPE } from "@predikt/orders";
import { OrderSide, SignatureType } from "../orders.ts";
import type { RelayConfig } from "../config/env.ts";
import { EXCHANGE_ABI, ERC20_ABI, ERC1155_ABI } from "./abi.ts";

// The on-chain EIP-712 domain is a load-bearing constant baked into the
// deployed CTFExchange (Hashing("Polymarket CTF Exchange", "1")). It MUST match
// exactly or every signature/hash diverges from the contract.
export const EIP712_DOMAIN_NAME = "Polymarket CTF Exchange";
export const EIP712_DOMAIN_VERSION = "1";

const ORDER_TYPES = {
    Order: [
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
    ],
} as const;

// On-chain tuple form expected by fillOrder/matchOrders.
export interface OnchainOrder {
    salt: bigint;
    maker: Hex;
    signer: Hex;
    taker: Hex;
    tokenId: bigint;
    makerAmount: bigint;
    takerAmount: bigint;
    expiration: bigint;
    nonce: bigint;
    feeRateBps: bigint;
    side: number;
    signatureType: number;
    signature: Hex;
}

export class ExchangeClient {
    readonly publicClient: PublicClient;
    readonly walletClient: WalletClient;
    readonly operator: Account;
    readonly exchange: Hex;
    readonly usdc: Hex;
    readonly ctf: Hex;
    readonly chainId: number;

    constructor(cfg: RelayConfig) {
        this.operator = privateKeyToAccount(cfg.operatorPk);
        this.exchange = cfg.exchangeAddress;
        this.usdc = cfg.usdcAddress;
        this.ctf = cfg.ctfAddress;
        this.chainId = cfg.chainId;

        const transport = http(cfg.rpcUrl);
        this.publicClient = createPublicClient({ transport });
        this.walletClient = createWalletClient({ account: this.operator, transport });
    }

    private domain() {
        return {
            name: EIP712_DOMAIN_NAME,
            version: EIP712_DOMAIN_VERSION,
            chainId: this.chainId,
            verifyingContract: this.exchange,
        } as const;
    }

    private message(order: SignedOrder) {
        return {
            salt: BigInt(order.salt),
            maker: order.maker as Hex,
            signer: order.signer as Hex,
            taker: order.taker as Hex,
            tokenId: BigInt(order.tokenId),
            makerAmount: BigInt(order.makerAmount),
            takerAmount: BigInt(order.takerAmount),
            expiration: BigInt(order.expiration),
            nonce: BigInt(order.nonce),
            feeRateBps: BigInt(order.feeRateBps),
            side: order.side,
            signatureType: order.signatureType,
        } as const;
    }

    /** Compute the exchange order hash for the given signed order (matches Hashing.hashOrder). */
    hashOrder(order: SignedOrder): Hex {
        return hashTypedData({
            domain: this.domain(),
            types: ORDER_TYPES,
            primaryType: "Order",
            message: this.message(order),
        });
    }

    /**
     * Verify the maker's EIP-712 signature. Only EOA orders (signer == maker,
     * ECDSA over the order hash) are accepted by the relay; proxy/safe/1271
     * types require on-chain resolution and are rejected at submit time.
     */
    async verifySignature(order: SignedOrder): Promise<boolean> {
        if (order.signatureType !== SignatureType.EOA) return false;
        if (order.signer.toLowerCase() !== order.maker.toLowerCase()) return false;
        return verifyTypedData({
            address: order.maker as Hex,
            domain: this.domain(),
            types: ORDER_TYPES,
            primaryType: "Order",
            message: this.message(order),
            signature: order.signature as Hex,
        });
    }

    /**
     * Verify a maker's EIP-712 "Cancel" authorisation over { orderHash, deadline }
     * against the dedicated relay domain (NOT the on-chain order domain). Returns
     * true only when the signature recovers to `expectedMaker`. This is what
     * authenticates `DELETE /orders/:hash` — it never touches the chain.
     */
    async verifyCancelSignature(params: {
        orderHash: Hex;
        deadline: number;
        signature: Hex;
        expectedMaker: Hex;
    }): Promise<boolean> {
        return verifyTypedData({
            address: params.expectedMaker,
            domain: cancelDomain(this.chainId),
            types: CANCEL_TYPES as unknown as Record<
                string,
                readonly { name: string; type: string }[]
            >,
            primaryType: CANCEL_PRIMARY_TYPE,
            message: { orderHash: params.orderHash, deadline: BigInt(params.deadline) },
            signature: params.signature,
        });
    }

    async isValidNonce(maker: Hex, nonce: bigint): Promise<boolean> {
        return this.publicClient.readContract({
            address: this.exchange,
            abi: EXCHANGE_ABI,
            functionName: "isValidNonce",
            args: [maker, nonce],
        });
    }

    /**
     * A registered token has a non-zero complement recorded on the exchange
     * (registerToken sets complements pairwise). getComplement reverts with
     * InvalidComplement for unregistered tokens, so a successful read that
     * returns a non-zero complement proves the token is tradable.
     */
    async isTokenRegistered(tokenId: bigint): Promise<boolean> {
        try {
            const complement = await this.publicClient.readContract({
                address: this.exchange,
                abi: EXCHANGE_ABI,
                functionName: "getComplement",
                args: [tokenId],
            });
            return complement !== 0n;
        } catch {
            return false;
        }
    }

    async onchainRemaining(orderHash: Hex): Promise<{ isFilledOrCancelled: boolean; remaining: bigint }> {
        const status = await this.publicClient.readContract({
            address: this.exchange,
            abi: EXCHANGE_ABI,
            functionName: "getOrderStatus",
            args: [orderHash],
        });
        return { isFilledOrCancelled: status.isFilledOrCancelled, remaining: status.remaining };
    }

    async usdcBalanceAndAllowance(owner: Hex): Promise<{ balance: bigint; allowance: bigint }> {
        const [balance, allowance] = await Promise.all([
            this.publicClient.readContract({
                address: this.usdc,
                abi: ERC20_ABI,
                functionName: "balanceOf",
                args: [owner],
            }),
            this.publicClient.readContract({
                address: this.usdc,
                abi: ERC20_ABI,
                functionName: "allowance",
                args: [owner, this.exchange],
            }),
        ]);
        return { balance, allowance };
    }

    async ctfBalanceAndApproval(
        owner: Hex,
        tokenId: bigint,
    ): Promise<{ balance: bigint; approved: boolean }> {
        const [balance, approved] = await Promise.all([
            this.publicClient.readContract({
                address: this.ctf,
                abi: ERC1155_ABI,
                functionName: "balanceOf",
                args: [owner, tokenId],
            }),
            this.publicClient.readContract({
                address: this.ctf,
                abi: ERC1155_ABI,
                functionName: "isApprovedForAll",
                args: [owner, this.exchange],
            }),
        ]);
        return { balance, approved };
    }

    toOnchain(order: SignedOrder): OnchainOrder {
        return {
            salt: BigInt(order.salt),
            maker: order.maker as Hex,
            signer: order.signer as Hex,
            taker: order.taker as Hex,
            tokenId: BigInt(order.tokenId),
            makerAmount: BigInt(order.makerAmount),
            takerAmount: BigInt(order.takerAmount),
            expiration: BigInt(order.expiration),
            nonce: BigInt(order.nonce),
            feeRateBps: BigInt(order.feeRateBps),
            side: order.side,
            signatureType: order.signatureType,
            signature: order.signature as Hex,
        };
    }

    /**
     * Submit matchOrders(taker, makers[], takerFill, makerFills[]) as OPERATOR.
     * `takerFill` and each `makerFills[i]` are in maker-amount units, exactly as
     * the contract's Trading._matchOrders expects. Simulates first so a revert
     * is surfaced before broadcasting (and no gas is wasted).
     */
    async matchOrders(
        taker: SignedOrder,
        makers: SignedOrder[],
        takerFill: bigint,
        makerFills: bigint[],
    ): Promise<Hex> {
        const { request } = await this.publicClient.simulateContract({
            address: this.exchange,
            abi: EXCHANGE_ABI,
            functionName: "matchOrders",
            args: [
                this.toOnchain(taker),
                makers.map((m) => this.toOnchain(m)),
                takerFill,
                makerFills,
            ],
            account: this.operator,
        });
        return this.walletClient.writeContract(request);
    }

    /**
     * Submit fillOrder(order, fillAmount) as OPERATOR — here the operator is the
     * counterparty (`to = msg.sender`), i.e. the operator supplies/receives the
     * taker-side assets. This is an OPERATOR-LIQUIDITY primitive, NOT the CLOB
     * matching path: the relay's book-vs-book settlement always uses matchOrders
     * (see RelayEngine.settle). Exposed for operators that also want to provide
     * liquidity directly against a single resting order.
     */
    async fillOrder(order: SignedOrder, fillAmount: bigint): Promise<Hex> {
        const { request } = await this.publicClient.simulateContract({
            address: this.exchange,
            abi: EXCHANGE_ABI,
            functionName: "fillOrder",
            args: [this.toOnchain(order), fillAmount],
            account: this.operator,
        });
        return this.walletClient.writeContract(request);
    }

    /** True when the maker can fund the *maker* side of a fill of `makingAmount`. */
    async makerCanFund(
        order: SignedOrder,
        makingAmount: bigint,
    ): Promise<{ ok: boolean; reason?: string }> {
        const maker = order.maker as Hex;
        if (Number(order.side) === OrderSide.BUY) {
            // BUY: maker supplies USDC (makerAsset = collateral, 6dp).
            const { balance, allowance } = await this.usdcBalanceAndAllowance(maker);
            if (balance < makingAmount) return { ok: false, reason: "insufficient USDC balance" };
            if (allowance < makingAmount) return { ok: false, reason: "insufficient USDC allowance" };
            return { ok: true };
        }
        // SELL: maker supplies outcome tokens (makerAsset = tokenId, ERC1155).
        const { balance, approved } = await this.ctfBalanceAndApproval(maker, BigInt(order.tokenId));
        if (!approved) return { ok: false, reason: "CTF not approved for exchange" };
        if (balance < makingAmount) return { ok: false, reason: "insufficient CTF balance" };
        return { ok: true };
    }
}
