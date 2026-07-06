import "dotenv/config";
import { z } from "zod";
import { getAddress, isAddress, isHex } from "viem";

// Market-maker configuration. This is a SEPARATE entrypoint from the relay
// server, so it has its own env surface — but it deliberately REUSES the same
// chain/exchange env keys (CHAIN_ID, RPC_URL, EXCHANGE_ADDRESS, USDC_ADDRESS,
// CTF_ADDRESS) as the relay so a single .env drives both. The maker's signing
// key is MM_PRIVATE_KEY, which is distinct from the relay's OPERATOR_PK: the
// maker is a normal user posting signed orders, NOT the operator.
//
// Secrets (MM_PRIVATE_KEY) are validated but NEVER echoed in error messages or
// logs.

const addressSchema = z
    .string()
    .refine((v) => isAddress(v), "must be a 20-byte hex address")
    .transform((v) => getAddress(v));

const pkSchema = z
    .string()
    .refine((v) => isHex(v) && v.length === 66, "must be a 0x-prefixed 32-byte hex key");

// MM_MARKETS is a comma-separated list of token ids (uint256 decimal strings)
// and/or oracle market ids. Token ids are numeric; anything non-numeric is
// treated as an oracle market id to discover its outcome token ids from the
// backend. Each entry is resolved to its YES + NO token pair before quoting.
const marketsSchema = z
    .string()
    .default("")
    .transform((v) =>
        v
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s.length > 0),
    );

const rawEnvSchema = z.object({
    // Maker EOA key — the source of funds and signer for every posted order.
    MM_PRIVATE_KEY: pkSchema,
    // Relay REST base URL (POST /orders, DELETE /orders/:hash, GET /book).
    RELAY_URL: z.string().url().default("http://localhost:8787"),
    MM_MARKETS: marketsSchema,
    // Half-spread per level, in basis points of the 0..1 probability. Level i
    // BUY sits at mid - (i+1)*spread, SELL at mid + (i+1)*spread.
    MM_SPREAD_BPS: z.coerce.number().int().positive().default(100),
    // Notional size per order, in whole USDC (converted to 6dp on-chain).
    MM_ORDER_SIZE: z.coerce.number().positive().default(10),
    // Depth: number of price levels quoted per side.
    MM_LEVELS: z.coerce.number().int().positive().max(20).default(3),
    // Refresh cadence: cancel + re-post the ladder every this many ms.
    MM_REFRESH_MS: z.coerce.number().int().positive().default(30_000),
    // If true, the maker mints outcome-token sets (splitPosition) so it can
    // quote SELL orders even with a zero CTF balance. Off by default because it
    // spends real USDC into conditional tokens.
    MM_MINT_SETS: z
        .string()
        .optional()
        .transform((v) => v === "true" || v === "1"),

    // ── Shared chain/exchange env (same keys as the relay) ──────────────────
    CHAIN_ID: z.coerce.number().int().positive(),
    RPC_URL: z.string().url(),
    EXCHANGE_ADDRESS: addressSchema,
    USDC_ADDRESS: addressSchema,
    CTF_ADDRESS: addressSchema,
});

export type MarketMakerConfig = {
    privateKey: `0x${string}`;
    relayUrl: string;
    markets: string[];
    spreadBps: number;
    orderSize: number;
    levels: number;
    refreshMs: number;
    mintSets: boolean;
    chainId: number;
    rpcUrl: string;
    exchangeAddress: `0x${string}`;
    usdcAddress: `0x${string}`;
    ctfAddress: `0x${string}`;
};

export function loadMarketMakerConfig(): MarketMakerConfig {
    const parsed = rawEnvSchema.safeParse(process.env);
    if (!parsed.success) {
        // Never print values — only the offending keys and reasons. The MM_PRIVATE_KEY
        // path is redacted to its key name only, never its value.
        const issues = parsed.error.issues
            .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
            .join("\n");
        throw new Error(`Invalid market-maker configuration:\n${issues}`);
    }

    const e = parsed.data;
    if (e.MM_MARKETS.length === 0) {
        throw new Error(
            "MM_MARKETS is empty — set a comma-separated list of token ids or oracle market ids to make",
        );
    }

    return {
        privateKey: e.MM_PRIVATE_KEY as `0x${string}`,
        relayUrl: e.RELAY_URL.replace(/\/+$/, ""),
        markets: e.MM_MARKETS as string[],
        spreadBps: e.MM_SPREAD_BPS,
        orderSize: e.MM_ORDER_SIZE,
        levels: e.MM_LEVELS,
        refreshMs: e.MM_REFRESH_MS,
        mintSets: e.MM_MINT_SETS,
        chainId: e.CHAIN_ID,
        rpcUrl: e.RPC_URL,
        exchangeAddress: e.EXCHANGE_ADDRESS as `0x${string}`,
        usdcAddress: e.USDC_ADDRESS as `0x${string}`,
        ctfAddress: e.CTF_ADDRESS as `0x${string}`,
    };
}
