import type { Hex } from "viem";
import type { SignedOrder } from "@predikt/orders";
import { OrderSide, SignatureType } from "./orders.ts";
import type { RelayConfig } from "./config/env.ts";
import type { Logger } from "./config/logger.ts";
import { ExchangeClient } from "./chain/exchange.ts";
import { EventIndexer } from "./chain/indexer.ts";
import { RelayStore } from "./store/db.ts";
import { OrderBook } from "./book/book.ts";
import type { BookOrder } from "./book/order.ts";
import { priceWad, statusFromRemaining } from "./book/order.ts";
import { isExecutable, planMatch, type MatchPlan } from "./book/matcher.ts";

export interface SubmitResult {
    hash: Hex;
    status: BookOrder["status"];
    matched: boolean;
    txHash?: Hex;
    fills: { makerHash: Hex; shares: string; makerFillAmount: string }[];
}

export class RelayEngine {
    readonly chain: ExchangeClient;
    readonly store: RelayStore;
    readonly book: OrderBook;
    readonly indexer: EventIndexer;
    private readonly log: Logger;
    // Confirmations to wait for before treating a settlement as final. On local
    // dev chains (Anvil/Hardhat/Ganache) 1 is enough; on real chains we wait for
    // 3 so a shallow reorg can't strand the book against the canonical chain.
    private readonly settlementConfirmations: number;
    // Serialize matching so we never build two conflicting fill plans against
    // the same resting order concurrently.
    private matchLock: Promise<void> = Promise.resolve();

    constructor(cfg: RelayConfig, log: Logger) {
        this.log = log;
        this.chain = new ExchangeClient(cfg);
        const LOCAL_CHAIN_IDS = new Set([31337, 1337]);
        this.settlementConfirmations = LOCAL_CHAIN_IDS.has(cfg.chainId) ? 1 : 3;
        this.store = new RelayStore(cfg.databasePath);
        this.book = new OrderBook();
        this.indexer = new EventIndexer(this.chain, this.store, this.book, log, cfg.startBlock);
    }

    async start(): Promise<void> {
        // Rehydrate resting orders from durable storage into the in-memory book.
        const active = this.store.listActiveOrders();
        for (const o of active) this.book.add(o);
        this.log.info({ rehydrated: active.length }, "book rehydrated from store");
        await this.indexer.start();
    }

    stop(): void {
        this.indexer.stop();
        this.store.close();
    }

    get operatorAddress(): Hex {
        return this.chain.operator.address;
    }

    /**
     * Validate and accept a signed EIP-712 order, then attempt to match it.
     * Validation (in order):
     *   1. EOA signature type only (relay does not resolve proxy/safe/1271)
     *   2. amounts / expiration sanity
     *   3. EIP-712 signature verifies against the exchange domain + maker
     *   4. tokenId registered on the exchange
     *   5. nonce still valid on-chain
     *   6. maker funds the maker side (balance + allowance/approval)
     *   7. not already filled/cancelled on-chain
     * Idempotent on order hash.
     */
    async submitOrder(order: SignedOrder): Promise<SubmitResult> {
        if (order.signatureType !== SignatureType.EOA) {
            throw new ValidationError("only EOA signature type is accepted by the relay");
        }
        const makerAmount = BigInt(order.makerAmount);
        const takerAmount = BigInt(order.takerAmount);
        if (makerAmount <= 0n || takerAmount <= 0n) {
            throw new ValidationError("makerAmount and takerAmount must be positive");
        }
        const expiration = BigInt(order.expiration);
        if (expiration !== 0n && expiration < BigInt(Math.floor(Date.now() / 1000))) {
            throw new ValidationError("order already expired");
        }

        const hash = this.chain.hashOrder(order);

        // Idempotency: return the existing state if we already know this order.
        const existing = this.store.getOrder(hash);
        if (existing) {
            return {
                hash,
                status: existing.status,
                matched: false,
                fills: [],
            };
        }

        const sigOk = await this.chain.verifySignature(order);
        if (!sigOk) throw new ValidationError("invalid EIP-712 signature");

        const tokenId = BigInt(order.tokenId);
        const registered = await this.chain.isTokenRegistered(tokenId);
        if (!registered) throw new ValidationError("tokenId is not registered for trading");

        const nonceOk = await this.chain.isValidNonce(order.maker as Hex, BigInt(order.nonce));
        if (!nonceOk) throw new ValidationError("order nonce is not valid");

        // Maker must be able to fund the full maker amount at accept time.
        const funding = await this.chain.makerCanFund(order, makerAmount);
        if (!funding.ok) throw new ValidationError(funding.reason ?? "maker cannot fund order");

        const onchain = await this.chain.onchainRemaining(hash);
        if (onchain.isFilledOrCancelled) {
            throw new ValidationError("order is already filled or cancelled on-chain");
        }
        const remainingMaker = onchain.remaining > 0n ? onchain.remaining : makerAmount;

        const now = Date.now();
        // Normalize the SDK's Side enum into the relay's local OrderSide (same
        // numeric encoding as OrderStructs.sol; nominally distinct TS type).
        const side: OrderSide = Number(order.side) === OrderSide.BUY ? OrderSide.BUY : OrderSide.SELL;
        const bookOrder: BookOrder = {
            hash,
            order,
            tokenId: order.tokenId,
            side,
            makerAmount,
            takerAmount,
            remainingMaker,
            status: statusFromRemaining(remainingMaker, makerAmount),
            priceWad: priceWad(side, makerAmount, takerAmount),
            createdAt: now,
            updatedAt: now,
        };

        this.store.upsertOrder(bookOrder);
        this.book.add(bookOrder);
        this.log.info(
            { hash, tokenId: order.tokenId, side: order.side, price: bookOrder.priceWad.toString() },
            "order accepted",
        );

        // Attempt to match immediately (marketable-order handling).
        const match = await this.tryMatch(bookOrder);
        return {
            hash,
            status: this.book.get(hash)?.status ?? bookOrder.status,
            matched: match.matched,
            txHash: match.txHash,
            fills: match.fills,
        };
    }

    /**
     * Maker-authenticated cancel. The caller must supply an EIP-712 "Cancel"
     * signature over { orderHash, deadline } produced by the order's maker. We
     * reject expired deadlines and any signature that does not recover to the
     * stored order's maker, then remove the order from the book and mark it
     * cancelled. Returns false only when the order is unknown (→ 404).
     */
    async cancelOrder(
        hash: Hex,
        proof: { signature: Hex; deadline: number },
    ): Promise<boolean> {
        const o = this.store.getOrder(hash);
        if (!o) return false;

        const nowSec = Math.floor(Date.now() / 1000);
        if (proof.deadline < nowSec) {
            throw new AuthError("cancel authorization has expired");
        }

        const maker = o.order.maker as Hex;
        const sigOk = await this.chain.verifyCancelSignature({
            orderHash: hash,
            deadline: proof.deadline,
            signature: proof.signature,
            expectedMaker: maker,
        });
        if (!sigOk) {
            throw new AuthError("cancel signature does not match the order maker");
        }

        if (o.status === "FILLED" || o.status === "CANCELLED") return true;
        this.store.updateOrderProgress(hash, o.remainingMaker, "CANCELLED", Date.now());
        this.book.remove(hash);
        this.log.info({ hash, maker }, "order cancelled (off-chain)");
        return true;
    }

    private async tryMatch(
        taker: BookOrder,
    ): Promise<{ matched: boolean; txHash?: Hex; fills: SubmitResult["fills"] }> {
        // Serialize plan+submit so concurrent takers don't double-spend a maker.
        let release!: () => void;
        const prev = this.matchLock;
        this.matchLock = new Promise<void>((res) => {
            release = res;
        });
        await prev;
        try {
            const plan = planMatch(this.book, taker);
            if (!isExecutable(plan)) return { matched: false, fills: [] };
            return await this.settle(plan);
        } finally {
            release();
        }
    }

    /**
     * Submit the real on-chain settlement for a match plan and let the indexer
     * reconcile order state from the emitted events.
     *
     * ALL crossed matches settle via matchOrders(taker, makers[], takerFill,
     * makerFills[]) — including the single-maker case (a 1-element makers array
     * is the canonical, tested pattern; see ctf-exchange MatchOrders.t.sol).
     *
     * We deliberately do NOT use fillOrder here. In fillOrder the operator is
     * the counterparty (`to = msg.sender`), so the operator must supply/receive
     * the taker-side assets — that is an operator-liquidity primitive, not
     * order-book matching. In matchOrders the taker order is the active order and
     * self-funds against the Exchange; the operator only pulls the fee. That is
     * the correct settlement for a CLOB relay where both sides are real signed
     * user orders, so it is used uniformly regardless of maker count.
     */
    private async settle(
        plan: MatchPlan,
    ): Promise<{ matched: boolean; txHash?: Hex; fills: SubmitResult["fills"] }> {
        const fills = plan.fills.map((f) => ({
            makerHash: f.maker.hash,
            shares: f.shares.toString(),
            makerFillAmount: f.makerFillAmount.toString(),
        }));

        let txHash: Hex;
        try {
            txHash = await this.chain.matchOrders(
                plan.taker.order,
                plan.fills.map((f) => f.maker.order),
                plan.takerFillAmount,
                plan.fills.map((f) => f.makerFillAmount),
            );
            this.log.info(
                {
                    taker: plan.taker.hash,
                    makers: plan.fills.length,
                    takerFill: plan.takerFillAmount.toString(),
                },
                "settled via matchOrders",
            );
        } catch (err) {
            // Simulation/broadcast failed — the book state is untouched. Log the
            // FULL error internally (raw viem/RPC revert reason) but never forward
            // that detail to the client: it can leak operator/RPC internals and
            // isn't actionable. Callers get a generic, retry-safe message.
            this.log.error({ err, taker: plan.taker.hash }, "settlement tx failed");
            throw new SettlementError("settlement failed — please retry");
        }

        // Pull events for this tx immediately so callers see fresh status. Require
        // confirmations on real (non-local) chains so a reorg can't strand the
        // book in a state that disagrees with the canonical chain.
        await this.chain.publicClient.waitForTransactionReceipt({
            hash: txHash,
            confirmations: this.settlementConfirmations,
        });
        await this.indexer.syncNow();

        return { matched: true, txHash, fills };
    }
}

export class ValidationError extends Error {}
export class SettlementError extends Error {}
/** Thrown when a request fails cryptographic authentication (→ 401). */
export class AuthError extends Error {}
