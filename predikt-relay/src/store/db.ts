import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type { SignedOrder } from "@predikt/orders";
import { OrderSide } from "../orders.ts";
import type { BookOrder, OrderStatus } from "../book/order.ts";
import { priceWad, statusFromRemaining } from "../book/order.ts";
import { signedOrderSchema } from "../api/schemas.ts";

// Durable persistence for orders + trades. All maker/taker/remaining amounts are
// stored as decimal strings (uint256 does not fit in SQLite INTEGER). The book
// is rehydrated from this table on boot, so a restart never loses resting orders.

export interface TradeRecord {
    txHash: `0x${string}`;
    logIndex: number;
    orderHash: `0x${string}`;
    tokenId: string;
    maker: `0x${string}`;
    taker: `0x${string}`;
    makerAmountFilled: string;
    takerAmountFilled: string;
    fee: string;
    kind: "FILL" | "MATCH";
    blockNumber: string;
    createdAt: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS orders (
    hash            TEXT PRIMARY KEY,
    token_id        TEXT NOT NULL,
    maker           TEXT NOT NULL,
    side            INTEGER NOT NULL,
    maker_amount    TEXT NOT NULL,
    taker_amount    TEXT NOT NULL,
    remaining_maker TEXT NOT NULL,
    price_wad       TEXT NOT NULL,
    status          TEXT NOT NULL,
    order_json      TEXT NOT NULL,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_book ON orders (token_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_maker ON orders (maker);

CREATE TABLE IF NOT EXISTS trades (
    tx_hash             TEXT NOT NULL,
    log_index           INTEGER NOT NULL,
    order_hash          TEXT NOT NULL,
    token_id            TEXT NOT NULL,
    maker               TEXT NOT NULL,
    taker               TEXT NOT NULL,
    maker_amount_filled TEXT NOT NULL,
    taker_amount_filled TEXT NOT NULL,
    fee                 TEXT NOT NULL,
    kind                TEXT NOT NULL,
    block_number        TEXT NOT NULL,
    created_at          INTEGER NOT NULL,
    PRIMARY KEY (tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS idx_trades_token ON trades (token_id);

CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
`;

interface OrderRow {
    hash: string;
    token_id: string;
    maker: string;
    side: number;
    maker_amount: string;
    taker_amount: string;
    remaining_maker: string;
    price_wad: string;
    status: string;
    order_json: string;
    created_at: number;
    updated_at: number;
}

export class RelayStore {
    private readonly db: Database.Database;

    constructor(path: string) {
        mkdirSync(dirname(path), { recursive: true });
        this.db = new Database(path);
        this.db.pragma("journal_mode = WAL");
        this.db.pragma("foreign_keys = ON");
        this.db.exec(SCHEMA);
    }

    close(): void {
        this.db.close();
    }

    // ── meta (cursor) ─────────────────────────────────────────────────────
    getMeta(key: string): string | undefined {
        const row = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as
            | { value: string }
            | undefined;
        return row?.value;
    }

    setMeta(key: string, value: string): void {
        this.db
            .prepare(
                "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            )
            .run(key, value);
    }

    // ── orders ────────────────────────────────────────────────────────────
    upsertOrder(o: BookOrder): void {
        this.db
            .prepare(
                `INSERT INTO orders
                 (hash, token_id, maker, side, maker_amount, taker_amount, remaining_maker, price_wad, status, order_json, created_at, updated_at)
                 VALUES (@hash, @token_id, @maker, @side, @maker_amount, @taker_amount, @remaining_maker, @price_wad, @status, @order_json, @created_at, @updated_at)
                 ON CONFLICT(hash) DO UPDATE SET
                   remaining_maker = excluded.remaining_maker,
                   status = excluded.status,
                   updated_at = excluded.updated_at`,
            )
            .run({
                hash: o.hash,
                token_id: o.tokenId,
                maker: o.order.maker.toLowerCase(),
                side: o.side,
                maker_amount: o.makerAmount.toString(),
                taker_amount: o.takerAmount.toString(),
                remaining_maker: o.remainingMaker.toString(),
                price_wad: o.priceWad.toString(),
                status: o.status,
                order_json: JSON.stringify(o.order),
                created_at: o.createdAt,
                updated_at: o.updatedAt,
            });
    }

    getOrder(hash: string): BookOrder | undefined {
        const row = this.db.prepare("SELECT * FROM orders WHERE hash = ?").get(hash) as
            | OrderRow
            | undefined;
        return row ? rowToOrder(row) : undefined;
    }

    updateOrderProgress(hash: string, remainingMaker: bigint, status: OrderStatus, ts: number): void {
        this.db
            .prepare(
                "UPDATE orders SET remaining_maker = ?, status = ?, updated_at = ? WHERE hash = ?",
            )
            .run(remainingMaker.toString(), status, ts, hash);
    }

    /** All still-fillable (OPEN / PARTIALLY_FILLED) orders — for book rehydration. */
    listActiveOrders(): BookOrder[] {
        const rows = this.db
            .prepare("SELECT * FROM orders WHERE status IN ('OPEN','PARTIALLY_FILLED')")
            .all() as OrderRow[];
        return rows.map(rowToOrder);
    }

    listOrdersByMaker(maker: string, limit = 500): BookOrder[] {
        // Cap the result set (newest first) to bound response size / work, mirroring
        // the trades cap. Callers may request a smaller limit via `?limit=`.
        const capped = Math.max(1, Math.min(limit, 500));
        const rows = this.db
            .prepare("SELECT * FROM orders WHERE maker = ? ORDER BY created_at DESC LIMIT ?")
            .all(maker.toLowerCase(), capped) as OrderRow[];
        return rows.map(rowToOrder);
    }

    // ── trades ────────────────────────────────────────────────────────────
    insertTrade(t: TradeRecord): boolean {
        const res = this.db
            .prepare(
                `INSERT OR IGNORE INTO trades
                 (tx_hash, log_index, order_hash, token_id, maker, taker, maker_amount_filled, taker_amount_filled, fee, kind, block_number, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
                t.txHash,
                t.logIndex,
                t.orderHash,
                t.tokenId,
                t.maker.toLowerCase(),
                t.taker.toLowerCase(),
                t.makerAmountFilled,
                t.takerAmountFilled,
                t.fee,
                t.kind,
                t.blockNumber,
                t.createdAt,
            );
        return res.changes > 0;
    }

    listTradesByToken(tokenId: string, limit = 200): TradeRecord[] {
        const rows = this.db
            .prepare(
                "SELECT * FROM trades WHERE token_id = ? ORDER BY created_at DESC LIMIT ?",
            )
            .all(tokenId, limit) as Record<string, unknown>[];
        return rows.map(rowToTrade);
    }
}

function rowToOrder(row: OrderRow): BookOrder {
    // Re-validate the persisted order against the same boundary schema used on
    // intake. A row that no longer parses (corruption / schema drift) is a hard
    // integrity error we fail loudly on rather than rehydrating a bad order.
    const parsed = signedOrderSchema.safeParse(JSON.parse(row.order_json));
    if (!parsed.success) {
        throw new Error(
            `corrupt order row ${row.hash}: ${parsed.error.issues[0]?.message ?? "invalid order json"}`,
        );
    }
    const order = parsed.data as unknown as SignedOrder;
    const makerAmount = BigInt(row.maker_amount);
    const takerAmount = BigInt(row.taker_amount);
    const remainingMaker = BigInt(row.remaining_maker);
    const side = row.side as OrderSide;
    return {
        hash: row.hash as `0x${string}`,
        order,
        tokenId: row.token_id,
        side,
        makerAmount,
        takerAmount,
        remainingMaker,
        status: row.status as OrderStatus,
        priceWad: row.price_wad ? BigInt(row.price_wad) : priceWad(side, makerAmount, takerAmount),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function rowToTrade(row: Record<string, unknown>): TradeRecord {
    return {
        txHash: row.tx_hash as `0x${string}`,
        logIndex: row.log_index as number,
        orderHash: row.order_hash as `0x${string}`,
        tokenId: row.token_id as string,
        maker: row.maker as `0x${string}`,
        taker: row.taker as `0x${string}`,
        makerAmountFilled: row.maker_amount_filled as string,
        takerAmountFilled: row.taker_amount_filled as string,
        fee: row.fee as string,
        kind: row.kind as "FILL" | "MATCH",
        blockNumber: row.block_number as string,
        createdAt: row.created_at as number,
    };
}

// Re-export for callers that need to recompute status.
export { statusFromRemaining };
