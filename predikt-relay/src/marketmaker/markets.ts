import type { Hex } from "viem";
import type { MarketMakerChain } from "./chain.ts";

// A resolved market outcome pair the maker quotes on: the two complementary
// ERC1155 token ids and their shared on-chain conditionId (for minting sets).
export interface ResolvedMarket {
    /** Original MM_MARKETS entry that produced this pair. */
    source: string;
    yesTokenId: bigint;
    noTokenId: bigint;
    conditionId: Hex;
}

// Minimal shape of an oracle market's outcome tokens, when discovering token
// ids from a backend market id rather than being given raw token ids.
interface OracleMarketTokens {
    // Predikt/oracle market payloads expose the CTF token ids for each outcome.
    // We look for a `tokens`/`outcomeTokens` array of { token_id/tokenId } or a
    // clobTokenIds array. Missing ⇒ the entry can't be resolved this way.
    tokens?: Array<{ token_id?: string; tokenId?: string; outcome?: string }>;
    clobTokenIds?: string[];
    probability?: number;
    p?: number;
}

function isNumericId(entry: string): boolean {
    return /^\d+$/.test(entry);
}

/**
 * Resolve one MM_MARKETS entry into a YES/NO token pair. Numeric entries are
 * treated as a token id directly; the complement is read from the exchange.
 * Non-numeric entries are treated as oracle market ids and their token ids are
 * discovered from the backend. Every pair is validated on-chain (non-zero
 * complement + readable conditionId) before it is quoted.
 */
export async function resolveMarket(
    chain: MarketMakerChain,
    relayApiUrl: string | undefined,
    entry: string,
): Promise<ResolvedMarket | undefined> {
    let yesTokenId: bigint | undefined;

    if (isNumericId(entry)) {
        yesTokenId = BigInt(entry);
    } else if (relayApiUrl) {
        yesTokenId = await discoverTokenIdFromOracle(relayApiUrl, entry);
    }
    if (yesTokenId === undefined) return undefined;

    const complement = await chain.getComplement(yesTokenId);
    if (complement === 0n) return undefined; // not a registered tradable token

    let conditionId: Hex;
    try {
        conditionId = await chain.getConditionId(yesTokenId);
    } catch {
        return undefined;
    }

    return {
        source: entry,
        yesTokenId,
        noTokenId: complement,
        conditionId,
    };
}

/**
 * Fetch an oracle market by id and extract its first CTF outcome token id.
 * Best-effort against the Predikt/oracle backend market payload; returns
 * undefined if the market can't be fetched or exposes no token ids.
 */
async function discoverTokenIdFromOracle(
    apiUrl: string,
    marketId: string,
): Promise<bigint | undefined> {
    try {
        const res = await fetch(`${apiUrl}/market/${encodeURIComponent(marketId)}`);
        if (!res.ok) return undefined;
        const market = (await res.json()) as OracleMarketTokens;
        const first =
            market.tokens?.find((t) => t.token_id ?? t.tokenId) ??
            (market.clobTokenIds?.[0] ? { token_id: market.clobTokenIds[0] } : undefined);
        const raw = first?.token_id ?? first?.tokenId;
        if (raw && /^\d+$/.test(raw)) return BigInt(raw);
        return undefined;
    } catch {
        return undefined;
    }
}

/**
 * Fetch the oracle-implied probability (0..1) for a market id, used as the mid
 * fallback when the relay book is empty. Returns undefined when unavailable so
 * the caller can fall back to 0.5.
 */
export async function fetchOracleProbability(
    apiUrl: string,
    marketId: string,
): Promise<number | undefined> {
    try {
        const res = await fetch(`${apiUrl}/market/${encodeURIComponent(marketId)}`);
        if (!res.ok) return undefined;
        const market = (await res.json()) as OracleMarketTokens;
        const p = market.probability ?? market.p;
        if (typeof p === "number" && Number.isFinite(p) && p > 0 && p < 1) return p;
        return undefined;
    } catch {
        return undefined;
    }
}
