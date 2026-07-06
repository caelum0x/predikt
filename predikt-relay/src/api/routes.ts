import { Router, type Request, type Response } from "express";
import type { Hex } from "viem";
import type { SignedOrder } from "@predikt/orders";
import { OrderSide } from "../orders.ts";
import type { RelayEngine } from "../engine.ts";
import { ValidationError, SettlementError, AuthError } from "../engine.ts";
import type { BookOrder } from "../book/order.ts";
import {
    bookQuerySchema,
    cancelBodySchema,
    hex32,
    ordersQuerySchema,
    signedOrderSchema,
    tradesQuerySchema,
} from "./schemas.ts";

// Consistent API envelope: { success, data?, error? }.
function ok<T>(res: Response, data: T, code = 200): void {
    res.status(code).json({ success: true, data });
}
function fail(res: Response, code: number, error: string): void {
    res.status(code).json({ success: false, error });
}

function orderView(o: BookOrder) {
    return {
        hash: o.hash,
        maker: o.order.maker,
        tokenId: o.tokenId,
        side: o.side === OrderSide.BUY ? "BUY" : "SELL",
        makerAmount: o.makerAmount.toString(),
        takerAmount: o.takerAmount.toString(),
        remainingMaker: o.remainingMaker.toString(),
        priceWad: o.priceWad.toString(),
        status: o.status,
        createdAt: o.createdAt,
        updatedAt: o.updatedAt,
    };
}

export function buildRouter(engine: RelayEngine): Router {
    const router = Router();

    // ── health ────────────────────────────────────────────────────────────
    router.get("/health", async (_req: Request, res: Response) => {
        try {
            const blockNumber = await engine.chain.publicClient.getBlockNumber();
            ok(res, {
                status: "ok",
                operator: engine.operatorAddress,
                exchange: engine.chain.exchange,
                chainId: engine.chain.chainId,
                blockNumber: blockNumber.toString(),
            });
        } catch (err) {
            fail(res, 503, `rpc unreachable: ${msg(err)}`);
        }
    });

    // ── POST /orders — accept a signed EIP-712 order ────────────────────────
    router.post("/orders", async (req: Request, res: Response) => {
        const parsed = signedOrderSchema.safeParse(req.body);
        if (!parsed.success) {
            return fail(res, 400, `invalid order: ${parsed.error.issues[0]?.message ?? "bad payload"}`);
        }
        const order = parsed.data as unknown as SignedOrder;
        try {
            const result = await engine.submitOrder(order);
            return ok(res, result, 201);
        } catch (err) {
            if (err instanceof ValidationError) return fail(res, 422, err.message);
            if (err instanceof SettlementError) return fail(res, 502, err.message);
            return fail(res, 500, msg(err));
        }
    });

    // ── DELETE /orders/:hash — cryptographically-authenticated cancel ───────
    // Requires an EIP-712 "Cancel" signature over { orderHash, deadline } from
    // the order's maker (see @predikt/orders signCancel). The relay recovers the
    // signer and rejects anything that isn't the stored maker (→ 401).
    router.delete("/orders/:hash", async (req: Request, res: Response) => {
        const hashParse = hex32.safeParse(req.params.hash);
        if (!hashParse.success) return fail(res, 400, "invalid order hash");
        const bodyParse = cancelBodySchema.safeParse(req.body ?? {});
        if (!bodyParse.success) {
            return fail(res, 400, "cancel requires a { signature, deadline } EIP-712 proof");
        }
        try {
            const found = await engine.cancelOrder(hashParse.data as Hex, {
                signature: bodyParse.data.signature as Hex,
                deadline: bodyParse.data.deadline,
            });
            if (!found) return fail(res, 404, "order not found");
            return ok(res, { hash: hashParse.data, status: "CANCELLED" });
        } catch (err) {
            if (err instanceof AuthError) return fail(res, 401, err.message);
            if (err instanceof ValidationError) return fail(res, 403, err.message);
            return fail(res, 500, msg(err));
        }
    });

    // ── GET /book?tokenId= — aggregated resting book ────────────────────────
    router.get("/book", (req: Request, res: Response) => {
        const parsed = bookQuerySchema.safeParse(req.query);
        if (!parsed.success) return fail(res, 400, "tokenId query param required");
        const snap = engine.book.snapshot(parsed.data.tokenId);
        ok(res, {
            tokenId: parsed.data.tokenId,
            bids: snap.bids.map(orderView),
            asks: snap.asks.map(orderView),
        });
    });

    // ── GET /orders?maker= — a maker's orders ───────────────────────────────
    router.get("/orders", (req: Request, res: Response) => {
        const parsed = ordersQuerySchema.safeParse(req.query);
        if (!parsed.success) return fail(res, 400, "maker query param required");
        const orders = engine.store.listOrdersByMaker(parsed.data.maker, parsed.data.limit ?? 500);
        ok(res, { maker: parsed.data.maker, orders: orders.map(orderView) });
    });

    // ── GET /trades?tokenId= — settled fills ────────────────────────────────
    router.get("/trades", (req: Request, res: Response) => {
        const parsed = tradesQuerySchema.safeParse(req.query);
        if (!parsed.success) return fail(res, 400, "tokenId query param required");
        const trades = engine.store.listTradesByToken(parsed.data.tokenId);
        ok(res, { tokenId: parsed.data.tokenId, trades });
    });

    return router;
}

function msg(err: unknown): string {
    return err instanceof Error ? err.message : "internal error";
}
