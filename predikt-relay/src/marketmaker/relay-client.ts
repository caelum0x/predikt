import type { Hex } from "viem";
import type { SignedOrder } from "@predikt/orders";
import { signCancel } from "@predikt/orders";
import type { ClobSigner } from "@predikt/orders";

// Shape of a resting order as returned by the relay's GET /book (orderView).
export interface RelayBookOrder {
    hash: Hex;
    maker: string;
    tokenId: string;
    side: "BUY" | "SELL";
    makerAmount: string;
    takerAmount: string;
    remainingMaker: string;
    priceWad: string;
    status: string;
    createdAt: number;
    updatedAt: number;
}

export interface RelayBook {
    tokenId: string;
    bids: RelayBookOrder[];
    asks: RelayBookOrder[];
}

interface Envelope<T> {
    success: boolean;
    data?: T;
    error?: string;
}

// REST client for the Predikt relay. Only the three endpoints the maker needs:
// submit a signed order, read the book, and cryptographically-authenticated
// cancel. All responses use the relay's { success, data?, error? } envelope.
export class RelayClient {
    private readonly baseUrl: string;
    private readonly chainId: number;

    constructor(baseUrl: string, chainId: number) {
        this.baseUrl = baseUrl;
        this.chainId = chainId;
    }

    /** Submit a signed EIP-712 order. Returns the relay's accepted result. */
    async postOrder(order: SignedOrder): Promise<{ hash: Hex; status: string }> {
        const res = await fetch(`${this.baseUrl}/orders`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(order),
        });
        const body = (await res.json()) as Envelope<{ hash: Hex; status: string }>;
        if (!res.ok || !body.success || !body.data) {
            throw new Error(`POST /orders failed (${res.status}): ${body.error ?? "unknown error"}`);
        }
        return body.data;
    }

    /** Read the aggregated resting book for a single outcome token. */
    async getBook(tokenId: string): Promise<RelayBook> {
        const res = await fetch(`${this.baseUrl}/book?tokenId=${encodeURIComponent(tokenId)}`);
        const body = (await res.json()) as Envelope<RelayBook>;
        if (!res.ok || !body.success || !body.data) {
            throw new Error(`GET /book failed (${res.status}): ${body.error ?? "unknown error"}`);
        }
        return body.data;
    }

    /**
     * Cancel a resting order. The relay requires an EIP-712 "Cancel" proof over
     * { orderHash, deadline } signed by the order's maker — produced here via
     * the SDK's signCancel against the relay cancel domain. Returns true when
     * the order was cancelled or already gone (404), false on auth failure.
     */
    async cancelOrder(signer: ClobSigner, hash: Hex, ttlSeconds = 120): Promise<boolean> {
        const deadline = Math.floor(Date.now() / 1000) + ttlSeconds;
        const signature = await signCancel(signer, {
            chainId: this.chainId,
            orderHash: hash,
            deadline,
        });
        const res = await fetch(`${this.baseUrl}/orders/${hash}`, {
            method: "DELETE",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ signature, deadline }),
        });
        if (res.status === 404) return true; // already gone — treat as cancelled
        const body = (await res.json()) as Envelope<unknown>;
        return res.ok && body.success === true;
    }
}
