import type { Hex } from "viem";
import { parseAbiItem } from "viem";
import type { ExchangeClient } from "./exchange.ts";
import type { RelayStore, TradeRecord } from "../store/db.ts";
import type { OrderBook } from "../book/book.ts";
import { statusFromRemaining } from "../book/order.ts";
import type { Logger } from "../config/logger.ts";

const ORDER_FILLED = parseAbiItem(
    "event OrderFilled(bytes32 indexed orderHash, address indexed maker, address indexed taker, uint256 makerAssetId, uint256 takerAssetId, uint256 makerAmountFilled, uint256 takerAmountFilled, uint256 fee)",
);
const ORDERS_MATCHED = parseAbiItem(
    "event OrdersMatched(bytes32 indexed takerOrderHash, address indexed takerOrderMaker, uint256 makerAssetId, uint256 takerAssetId, uint256 makerAmountFilled, uint256 takerAmountFilled)",
);
const ORDER_CANCELLED = parseAbiItem("event OrderCancelled(bytes32 indexed orderHash)");

const CURSOR_KEY = "indexer.lastBlock";
const POLL_MS = 4_000;
const BLOCK_SPAN = 2_000n;

/**
 * Polls the exchange for OrderFilled / OrdersMatched / OrderCancelled and makes
 * the relay's view of order status authoritative from *on-chain events only*.
 * No fill is ever recorded off a simulated/optimistic result — a trade row and
 * a remaining-amount decrement happen strictly when the event lands.
 */
export class EventIndexer {
    private cursor = 0n;
    private running = false;
    private timer?: NodeJS.Timeout;
    private cursorInitialized = false;

    // Explicit fields + assignments (not TS parameter properties) so the relay
    // also runs under Node's --experimental-strip-types dev entrypoint.
    private readonly chain: ExchangeClient;
    private readonly store: RelayStore;
    private readonly book: OrderBook;
    private readonly log: Logger;
    private readonly startBlock?: bigint;

    constructor(
        chain: ExchangeClient,
        store: RelayStore,
        book: OrderBook,
        log: Logger,
        startBlock?: bigint,
    ) {
        this.chain = chain;
        this.store = store;
        this.book = book;
        this.log = log;
        this.startBlock = startBlock;
    }

    async start(): Promise<void> {
        const saved = this.store.getMeta(CURSOR_KEY);
        if (saved) {
            this.cursor = BigInt(saved);
            this.cursorInitialized = true;
        } else if (this.startBlock !== undefined) {
            this.cursor = this.startBlock;
            this.cursorInitialized = true;
        }
        // If neither a saved cursor nor START_BLOCK is available, defer the
        // "start at head" fetch to the first successful scan so a transient RPC
        // failure at boot does not prevent the HTTP server from coming up.
        this.running = true;
        this.log.info(
            { fromBlock: this.cursorInitialized ? this.cursor.toString() : "head (deferred)" },
            "indexer started",
        );
        void this.loop();
    }

    private async ensureCursor(head: bigint): Promise<void> {
        if (!this.cursorInitialized) {
            this.cursor = head;
            this.cursorInitialized = true;
        }
    }

    stop(): void {
        this.running = false;
        if (this.timer) clearTimeout(this.timer);
    }

    /** Force a single catch-up pass (used right after submitting a tx). */
    async syncNow(): Promise<void> {
        await this.scan();
    }

    private async loop(): Promise<void> {
        if (!this.running) return;
        try {
            await this.scan();
        } catch (err) {
            this.log.error({ err }, "indexer scan failed");
        }
        if (this.running) this.timer = setTimeout(() => void this.loop(), POLL_MS);
    }

    private async scan(): Promise<void> {
        const head = await this.chain.publicClient.getBlockNumber();
        await this.ensureCursor(head);
        while (this.cursor < head) {
            const from = this.cursor + 1n;
            const to = from + BLOCK_SPAN - 1n > head ? head : from + BLOCK_SPAN - 1n;
            await this.scanRange(from, to);
            this.cursor = to;
            this.store.setMeta(CURSOR_KEY, this.cursor.toString());
        }
    }

    private async scanRange(fromBlock: bigint, toBlock: bigint): Promise<void> {
        const [filled, matched, cancelled] = await Promise.all([
            this.chain.publicClient.getLogs({
                address: this.chain.exchange,
                event: ORDER_FILLED,
                fromBlock,
                toBlock,
            }),
            this.chain.publicClient.getLogs({
                address: this.chain.exchange,
                event: ORDERS_MATCHED,
                fromBlock,
                toBlock,
            }),
            this.chain.publicClient.getLogs({
                address: this.chain.exchange,
                event: ORDER_CANCELLED,
                fromBlock,
                toBlock,
            }),
        ]);

        for (const log of filled) {
            await this.onFilled(log);
        }
        for (const log of matched) {
            // OrdersMatched carries the aggregate taker fill; the per-maker
            // OrderFilled events (also emitted) drive maker remaining updates.
            await this.onMatched(log);
        }
        for (const log of cancelled) {
            this.onCancelled(log.args.orderHash as Hex);
        }
    }

    private async onFilled(log: {
        args: {
            orderHash?: Hex;
            maker?: Hex;
            taker?: Hex;
            makerAmountFilled?: bigint;
            takerAmountFilled?: bigint;
            fee?: bigint;
        };
        transactionHash: Hex | null;
        logIndex: number;
        blockNumber: bigint | null;
    }): Promise<void> {
        const orderHash = log.args.orderHash;
        if (!orderHash || !log.transactionHash || log.blockNumber === null) return;
        const bookOrder = this.store.getOrder(orderHash);
        const tokenId = bookOrder?.tokenId ?? "0";

        const trade: TradeRecord = {
            txHash: log.transactionHash,
            logIndex: log.logIndex,
            orderHash,
            tokenId,
            maker: (log.args.maker ?? "0x0000000000000000000000000000000000000000") as Hex,
            taker: (log.args.taker ?? "0x0000000000000000000000000000000000000000") as Hex,
            makerAmountFilled: (log.args.makerAmountFilled ?? 0n).toString(),
            takerAmountFilled: (log.args.takerAmountFilled ?? 0n).toString(),
            fee: (log.args.fee ?? 0n).toString(),
            kind: "FILL",
            blockNumber: log.blockNumber.toString(),
            createdAt: Date.now(),
        };
        const isNew = this.store.insertTrade(trade);
        if (!isNew) return; // already processed (idempotent on tx+logIndex)

        if (bookOrder) {
            // Reconcile remaining directly from the contract — authoritative.
            const { remaining } = await this.chain.onchainRemaining(orderHash);
            const status = statusFromRemaining(remaining, bookOrder.makerAmount);
            this.store.updateOrderProgress(orderHash, remaining, status, Date.now());
            const inBook = this.book.get(orderHash);
            if (inBook) {
                inBook.remainingMaker = remaining;
                inBook.status = status;
                inBook.updatedAt = Date.now();
                this.book.refresh(bookOrder.tokenId);
            }
            this.log.info(
                { orderHash, remaining: remaining.toString(), status },
                "order fill indexed",
            );
        }
    }

    private async onMatched(log: {
        args: { takerOrderHash?: Hex; makerAmountFilled?: bigint; takerAmountFilled?: bigint };
        transactionHash: Hex | null;
        logIndex: number;
        blockNumber: bigint | null;
    }): Promise<void> {
        const orderHash = log.args.takerOrderHash;
        if (!orderHash || !log.transactionHash || log.blockNumber === null) return;
        const bookOrder = this.store.getOrder(orderHash);
        const tokenId = bookOrder?.tokenId ?? "0";
        const trade: TradeRecord = {
            txHash: log.transactionHash,
            logIndex: log.logIndex,
            orderHash,
            tokenId,
            maker: "0x0000000000000000000000000000000000000000",
            taker: "0x0000000000000000000000000000000000000000",
            makerAmountFilled: (log.args.makerAmountFilled ?? 0n).toString(),
            takerAmountFilled: (log.args.takerAmountFilled ?? 0n).toString(),
            fee: "0",
            kind: "MATCH",
            blockNumber: log.blockNumber.toString(),
            createdAt: Date.now(),
        };
        this.store.insertTrade(trade);
        // Taker remaining is reconciled by its own OrderFilled event above.
    }

    private onCancelled(orderHash: Hex): void {
        const bookOrder = this.store.getOrder(orderHash);
        if (!bookOrder) return;
        this.store.updateOrderProgress(orderHash, bookOrder.remainingMaker, "CANCELLED", Date.now());
        this.book.remove(orderHash);
        this.log.info({ orderHash }, "order cancellation indexed");
    }
}
