import "dotenv/config";
import { z } from "zod";
import { getAddress, isAddress, isHex } from "viem";

// Validate all boundary configuration up front and fail fast with a clear
// message. Secrets (OPERATOR_PK) are parsed but NEVER echoed back in errors.

const addressSchema = z
    .string()
    .refine((v) => isAddress(v), "must be a 20-byte hex address")
    .transform((v) => getAddress(v));

const pkSchema = z
    .string()
    .refine((v) => isHex(v) && v.length === 66, "OPERATOR_PK must be a 0x-prefixed 32-byte hex key");

const rawEnvSchema = z.object({
    PORT: z.coerce.number().int().positive().default(8787),
    SUBMIT_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(60),
    // Higher per-IP allowance for the read endpoints (book/orders/trades/health).
    READ_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(600),
    // Comma-separated list of allowed CORS origins. Defaults to a single app
    // origin — never `*` — so credentialed browser reads stay scoped.
    RELAY_ALLOWED_ORIGINS: z
        .string()
        .default("http://localhost:3000")
        .transform((v) =>
            v
                .split(",")
                .map((s) => s.trim())
                .filter((s) => s.length > 0),
        ),
    // Number of proxy hops in front of the relay (for express `trust proxy`).
    TRUST_PROXY: z.coerce.number().int().min(0).default(1),
    CHAIN_ID: z.coerce.number().int().positive(),
    RPC_URL: z.string().url(),
    EXCHANGE_ADDRESS: addressSchema,
    USDC_ADDRESS: addressSchema,
    CTF_ADDRESS: addressSchema,
    OPERATOR_PK: pkSchema,
    DATABASE_PATH: z.string().min(1).default("./data/relay.db"),
    START_BLOCK: z
        .string()
        .optional()
        .transform((v) => (v && v.length > 0 ? BigInt(v) : undefined)),
});

export type RelayConfig = {
    port: number;
    submitRateLimitPerMin: number;
    readRateLimitPerMin: number;
    allowedOrigins: string[];
    trustProxy: number;
    chainId: number;
    rpcUrl: string;
    exchangeAddress: `0x${string}`;
    usdcAddress: `0x${string}`;
    ctfAddress: `0x${string}`;
    operatorPk: `0x${string}`;
    databasePath: string;
    startBlock?: bigint;
};

let cached: RelayConfig | null = null;

export function loadConfig(): RelayConfig {
    if (cached) return cached;

    const parsed = rawEnvSchema.safeParse(process.env);
    if (!parsed.success) {
        // Never print values — only the offending keys and reasons.
        const issues = parsed.error.issues
            .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
            .join("\n");
        throw new Error(`Invalid relay configuration:\n${issues}`);
    }

    const e = parsed.data;
    cached = {
        port: e.PORT,
        submitRateLimitPerMin: e.SUBMIT_RATE_LIMIT_PER_MIN,
        readRateLimitPerMin: e.READ_RATE_LIMIT_PER_MIN,
        allowedOrigins: e.RELAY_ALLOWED_ORIGINS,
        trustProxy: e.TRUST_PROXY,
        chainId: e.CHAIN_ID,
        rpcUrl: e.RPC_URL,
        exchangeAddress: e.EXCHANGE_ADDRESS as `0x${string}`,
        usdcAddress: e.USDC_ADDRESS as `0x${string}`,
        ctfAddress: e.CTF_ADDRESS as `0x${string}`,
        operatorPk: e.OPERATOR_PK as `0x${string}`,
        databasePath: e.DATABASE_PATH,
        startBlock: e.START_BLOCK,
    };
    return cached;
}
