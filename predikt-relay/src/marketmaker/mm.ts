import type { Hex, WalletClient } from "viem";
import type { ClobSigner } from "@predikt/orders";
import { logger } from "../config/logger.ts";
import { loadMarketMakerConfig, type MarketMakerConfig } from "./config.ts";
import { MarketMakerChain } from "./chain.ts";
import { RelayClient } from "./relay-client.ts";
import { resolveMarket, fetchOracleProbability, type ResolvedMarket } from "./markets.ts";
import { buildLadder, midFromBook, type Level } from "./pricing.ts";
import { signLevel } from "./order-factory.ts";

const log = logger.child({ mod: "marketmaker" });

// A single outcome token the maker quotes on, with the resolved market context.
interface Quote {
    market: ResolvedMarket;
    tokenId: bigint;
    // Track the hashes we posted so we can cancel exactly our own stale orders.
    liveHashes: Set<Hex>;
}

export class MarketMaker {
    private readonly chain: MarketMakerChain;
    private readonly relay: RelayClient;
    // The maker EOA's viem WalletClient doubles as the @predikt/orders ClobSigner.
    private readonly signer: ClobSigner;
    private quotes: Quote[] = [];
    private timer: NodeJS.Timeout | null = null;
    private running = false;
    private stopping = false;
    // Oracle backend base URL for probability fallback + token discovery. The
    // relay is a CLOB, not the oracle, so this reuses the same backend liquify
    // reads. Optional — absent ⇒ mid falls back to 0.5 when the book is empty.
    private readonly oracleApiUrl: string | undefined;
    private readonly cfg: MarketMakerConfig;

    constructor(cfg: MarketMakerConfig) {
        this.cfg = cfg;
        this.chain = new MarketMakerChain(cfg);
        this.relay = new RelayClient(cfg.relayUrl, cfg.chainId);
        this.signer = this.chain.walletClient as unknown as ClobSigner;
        this.oracleApiUrl = process.env.ORACLE_API_URL?.replace(/\/+$/, "");
    }

    /** Resolve markets, ensure approvals, then start the refresh loop. */
    async start(): Promise<void> {
        log.info(
            {
                maker: this.chain.address,
                relay: this.cfg.relayUrl,
                markets: this.cfg.markets,
                levels: this.cfg.levels,
                spreadBps: this.cfg.spreadBps,
                orderSize: this.cfg.orderSize,
            },
            "market maker starting",
        );

        await this.resolveMarkets();
        if (this.quotes.length === 0) {
            throw new Error("no tradable markets resolved from MM_MARKETS — nothing to quote");
        }
        await this.ensureApprovals();

        this.running = true;
        await this.refresh();
        this.timer = setInterval(() => {
            void this.refresh();
        }, this.cfg.refreshMs);
    }

    /** Cancel all open orders and stop the loop (graceful shutdown). */
    async stop(): Promise<void> {
        if (this.stopping) return;
        this.stopping = true;
        this.running = false;
        if (this.timer) clearInterval(this.timer);
        log.info("cancelling open orders before exit");
        await this.cancelAll();
        log.info("market maker stopped");
    }

    private async resolveMarkets(): Promise<void> {
        for (const entry of this.cfg.markets) {
            const market = await resolveMarket(this.chain, this.oracleApiUrl, entry);
            if (!market) {
                log.warn({ entry }, "skipping market — not a registered tradable token");
                continue;
            }
            // Quote BOTH outcome tokens (YES + NO) of the pair.
            this.quotes.push({ market, tokenId: market.yesTokenId, liveHashes: new Set() });
            this.quotes.push({ market, tokenId: market.noTokenId, liveHashes: new Set() });
            log.info(
                {
                    source: market.source,
                    yes: market.yesTokenId.toString(),
                    no: market.noTokenId.toString(),
                    conditionId: market.conditionId,
                },
                "resolved market",
            );
        }
    }

    /**
     * Ensure the exchange can pull the maker's USDC (for BUYs) and move its
     * outcome tokens (for SELLs). Both are one-time, idempotent approvals; we
     * only send a tx when the current state is insufficient.
     */
    private async ensureApprovals(): Promise<void> {
        const { allowance } = await this.chain.usdcBalanceAndAllowance();
        if (allowance === 0n) {
            log.info("approving USDC for the exchange");
            const tx = await this.chain.approveUsdc();
            await this.chain.waitForTx(tx);
        }
        // Any one token id reports the account-wide ERC1155 operator approval.
        const someToken = this.quotes[0]?.tokenId;
        if (someToken !== undefined) {
            const { approved } = await this.chain.ctfBalanceAndApproval(someToken);
            if (!approved) {
                log.info("approving CTF outcome tokens for the exchange");
                const tx = await this.chain.approveCtf();
                await this.chain.waitForTx(tx);
            }
        }
    }

    /** One cycle: cancel stale orders, then re-post a fresh ladder per token. */
    private async refresh(): Promise<void> {
        if (!this.running) return;
        try {
            await this.cancelAll();
            for (const quote of this.quotes) {
                await this.quoteToken(quote);
            }
        } catch (err) {
            log.error({ err: errMsg(err) }, "refresh cycle failed");
        }
    }

    private async quoteToken(quote: Quote): Promise<void> {
        const mid = await this.determineMid(quote);
        const ladder = buildLadder(mid, this.cfg.spreadBps, this.cfg.levels, this.cfg.orderSize);
        if (ladder.length === 0) return;

        // Fund-check each side ONCE for the whole ladder, using the total
        // notional/shares the ladder needs. Under-funded sides are skipped with
        // a clear warning — never faked.
        const buys = ladder.filter((l) => l.side === "BUY");
        const sells = ladder.filter((l) => l.side === "SELL");

        const canBuy = await this.checkBuyFunding(buys);
        const canSell = await this.checkSellFunding(quote, sells);

        const toPost: Level[] = [
            ...(canBuy ? buys : []),
            ...(canSell ? sells : []),
        ];

        for (const level of toPost) {
            await this.postLevel(quote, level);
        }
    }

    /**
     * Fair mid for a token: prefer the live relay book mid; else the oracle
     * probability (from the market's backend id); else 0.5. For the NO token,
     * the oracle probability is complemented (1 - p_yes).
     */
    private async determineMid(quote: Quote): Promise<number> {
        try {
            const book = await this.relay.getBook(quote.tokenId.toString());
            const bookMid = midFromBook(book);
            if (bookMid !== undefined) return bookMid;
        } catch (err) {
            log.warn({ err: errMsg(err), tokenId: quote.tokenId.toString() }, "book fetch failed");
        }

        if (this.oracleApiUrl && !/^\d+$/.test(quote.market.source)) {
            const p = await fetchOracleProbability(this.oracleApiUrl, quote.market.source);
            if (p !== undefined) {
                return quote.tokenId === quote.market.noTokenId ? 1 - p : p;
            }
        }
        return 0.5;
    }

    /** True when the maker can fund every BUY in the ladder (USDC bal+allowance). */
    private async checkBuyFunding(buys: Level[]): Promise<boolean> {
        if (buys.length === 0) return false;
        const neededUsdc = buys.reduce((sum, l) => sum + l.price * l.size, 0);
        const needed = BigInt(Math.ceil(neededUsdc * 1e6));
        const { balance, allowance } = await this.chain.usdcBalanceAndAllowance();
        if (balance < needed) {
            log.warn(
                { neededUsdc: neededUsdc.toFixed(2), balance: balance.toString() },
                "skipping BUY side — insufficient USDC balance",
            );
            return false;
        }
        if (allowance < needed) {
            log.warn("skipping BUY side — insufficient USDC allowance for the exchange");
            return false;
        }
        return true;
    }

    /**
     * True when the maker can fund every SELL in the ladder (CTF balance +
     * approval). When MM_MINT_SETS is on and the balance is short, mint the
     * shortfall via a real splitPosition (locks USDC into a full YES/NO set).
     */
    private async checkSellFunding(quote: Quote, sells: Level[]): Promise<boolean> {
        if (sells.length === 0) return false;
        const neededShares = sells.reduce((sum, l) => sum + l.size, 0);
        const needed = BigInt(Math.ceil(neededShares * 1e6));

        let { balance, approved } = await this.chain.ctfBalanceAndApproval(quote.tokenId);
        if (!approved) {
            log.warn("skipping SELL side — CTF not approved for the exchange");
            return false;
        }
        if (balance < needed && this.cfg.mintSets) {
            const shortfall = needed - balance;
            log.info(
                { tokenId: quote.tokenId.toString(), shortfall: shortfall.toString() },
                "minting outcome-token set to fund SELL side (splitPosition)",
            );
            try {
                const tx = await this.chain.splitPosition(quote.market.conditionId, shortfall);
                await this.chain.waitForTx(tx);
                ({ balance } = await this.chain.ctfBalanceAndApproval(quote.tokenId));
            } catch (err) {
                log.warn({ err: errMsg(err) }, "splitPosition mint failed — skipping SELL side");
                return false;
            }
        }
        if (balance < needed) {
            log.warn(
                { neededShares: neededShares.toFixed(2), balance: balance.toString() },
                "skipping SELL side — insufficient CTF balance (enable MM_MINT_SETS or pre-mint)",
            );
            return false;
        }
        return true;
    }

    private async postLevel(quote: Quote, level: Level): Promise<void> {
        try {
            const order = await signLevel(
                this.chain.walletClient as WalletClient,
                this.cfg.exchangeAddress,
                this.cfg.chainId,
                this.chain.address,
                quote.tokenId,
                level,
            );
            const { hash, status } = await this.relay.postOrder(order);
            quote.liveHashes.add(hash);
            log.info(
                {
                    tokenId: quote.tokenId.toString(),
                    side: level.side,
                    price: level.price.toFixed(4),
                    size: level.size,
                    hash,
                    status,
                },
                "posted order",
            );
        } catch (err) {
            log.warn(
                { err: errMsg(err), tokenId: quote.tokenId.toString(), side: level.side },
                "order post failed",
            );
        }
    }

    /** Cancel every order this maker currently has live, across all tokens. */
    private async cancelAll(): Promise<void> {
        for (const quote of this.quotes) {
            for (const hash of [...quote.liveHashes]) {
                try {
                    const ok = await this.relay.cancelOrder(this.signer, hash);
                    if (ok) quote.liveHashes.delete(hash);
                } catch (err) {
                    log.warn({ err: errMsg(err), hash }, "cancel failed");
                }
            }
        }
    }
}

function errMsg(err: unknown): string {
    return err instanceof Error ? err.message : "unknown error";
}

async function main(): Promise<void> {
    const cfg = loadMarketMakerConfig();
    const mm = new MarketMaker(cfg);
    await mm.start();

    let shuttingDown = false;
    const shutdown = async (sig: string): Promise<void> => {
        if (shuttingDown) return;
        shuttingDown = true;
        log.info({ sig }, "shutting down market maker");
        await mm.stop();
        process.exit(0);
    };
    process.on("SIGINT", () => void shutdown("SIGINT"));
    process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
    log.error({ err: errMsg(err) }, "fatal market-maker error");
    process.exit(1);
});
