import express from "express";
import cors from "cors";
import { rateLimit } from "express-rate-limit";
import { pinoHttp } from "pino-http";
import { loadConfig } from "./config/env.ts";
import { logger } from "./config/logger.ts";
import { RelayEngine } from "./engine.ts";
import { buildRouter } from "./api/routes.ts";

async function main(): Promise<void> {
    const cfg = loadConfig();
    const engine = new RelayEngine(cfg, logger);
    await engine.start();

    const app = express();
    app.disable("x-powered-by");
    // Trust N proxy hops so express-rate-limit keys off the real client IP (the
    // left-most X-Forwarded-For entry) rather than the proxy's address.
    app.set("trust proxy", cfg.trustProxy);

    // Scoped CORS: only the configured app origin(s) may call the relay from a
    // browser — never `*`. Requests with no Origin (curl/server-side) pass.
    const allowed = new Set(cfg.allowedOrigins);
    app.use(
        cors({
            origin(origin, callback) {
                if (!origin || allowed.has(origin)) return callback(null, true);
                return callback(new Error("origin not allowed by CORS"), false);
            },
            methods: ["GET", "POST", "DELETE", "OPTIONS"],
        }),
    );

    app.use(express.json({ limit: "64kb" }));
    app.use(pinoHttp({ logger }));

    // Rate-limit the write endpoints (order submit + cancel) per IP.
    const writeLimiter = rateLimit({
        windowMs: 60_000,
        limit: cfg.submitRateLimitPerMin,
        standardHeaders: "draft-7",
        legacyHeaders: false,
        message: { success: false, error: "rate limit exceeded" },
    });
    // Separate, higher-limit rate limiter for the read endpoints so heavy book /
    // trade polling can't be starved by the tighter write budget (and vice versa).
    const readLimiter = rateLimit({
        windowMs: 60_000,
        limit: cfg.readRateLimitPerMin,
        standardHeaders: "draft-7",
        legacyHeaders: false,
        message: { success: false, error: "rate limit exceeded" },
    });
    app.use("/orders", (req, res, next) => {
        if (req.method === "POST" || req.method === "DELETE") return writeLimiter(req, res, next);
        return next();
    });
    // GET reads: /book, /orders, /trades, /health.
    app.use((req, res, next) => {
        if (req.method === "GET") return readLimiter(req, res, next);
        return next();
    });

    app.use("/", buildRouter(engine));

    const server = app.listen(cfg.port, () => {
        logger.info(
            { port: cfg.port, operator: engine.operatorAddress, exchange: cfg.exchangeAddress },
            "Predikt CLOB relay operator listening",
        );
    });

    const shutdown = (sig: string) => {
        logger.info({ sig }, "shutting down");
        server.close(() => {
            engine.stop();
            process.exit(0);
        });
    };
    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
    logger.error({ err }, "fatal startup error");
    process.exit(1);
});
