// ─────────────────────────────────────────────────────────────────────────
// Emit the exact env blocks to paste into each consumer, derived PURELY from
// the deployed/primitive addresses. NO SECRETS are produced here — private keys
// (PRIVATE_KEY, OPERATOR_PK, MM_PRIVATE_KEY) are shown only as placeholders the
// operator fills in from their own secret store. Nothing here is written to disk
// beyond addresses.<chain>.json (public addresses only).
//
// Consumers:
//   1. oracle/web        — NEXT_PUBLIC_ONCHAIN_*  (public, client-visible)
//   2. predikt-relay     — .env  (chain + exchange + OPERATOR_PK placeholder)
//   3. market maker      — the MM_* half of predikt-relay/.env
// ─────────────────────────────────────────────────────────────────────────

const SECRET = "0x<FILL_FROM_YOUR_SECRET_STORE — never commit>";

// ── oracle/web (.env.local) — NEXT_PUBLIC_ONCHAIN_* ────────────────────────
// Matches the vars oracle/web/lib/onchain/addresses.ts requires. All PUBLIC.
export function webEnvBlock(a) {
    const { chain, primitives, deployed } = a;
    const lines = [
        `# oracle/web/.env.local — Predikt on-chain layer (${chain.label}, chain ${chain.chainId})`,
        `# All NEXT_PUBLIC_* are PUBLIC (client-visible). No secrets here.`,
        `NEXT_PUBLIC_ONCHAIN_UMA_ADAPTER=${deployed.umaCtfAdapter}`,
        `NEXT_PUBLIC_ONCHAIN_EXCHANGE=${deployed.ctfExchange}`,
        `NEXT_PUBLIC_ONCHAIN_CONDITIONAL_TOKENS=${primitives.ctf}`,
        `NEXT_PUBLIC_ONCHAIN_UMA_OPTIMISTIC_ORACLE=${primitives.umaOptimisticOracle}`,
        `# Collateral: MUST equal the exchange's COLLATERAL you deployed with.`,
        `NEXT_PUBLIC_ONCHAIN_USDC=${primitives.usdc}`,
        `# FPMM factory (instant-liquidity AMM). Per-market pools are created from this.`,
        `NEXT_PUBLIC_ONCHAIN_FPMM_FACTORY=${deployed.fpmmFactory}`,
    ];
    return lines.join("\n");
}

// ── predikt-relay (.env) — chain/exchange + OPERATOR_PK placeholder ────────
// Matches predikt-relay/.env.example. OPERATOR_PK is a placeholder ONLY.
export function relayEnvBlock(a) {
    const { chain, primitives, deployed, operatorAddress } = a;
    const lines = [
        `# predikt-relay/.env — CLOB relay operator (${chain.label}, chain ${chain.chainId})`,
        `PORT=8787`,
        `CHAIN_ID=${chain.chainId}`,
        `RPC_URL=${chain.rpc}`,
        `EXCHANGE_ADDRESS=${deployed.ctfExchange}`,
        `USDC_ADDRESS=${primitives.usdc}`,
        `CTF_ADDRESS=${primitives.ctf}`,
        `# Operator EOA granted the exchange operator role in step 4 (addOperator).`,
        `#   operator address = ${operatorAddress}`,
        `# The KEY stays secret — paste it from your secret store, NEVER commit it.`,
        `OPERATOR_PK=${SECRET}`,
        `DATABASE_PATH=./data/relay.db`,
        `RELAY_ALLOWED_ORIGINS=https://app.predikt.example`,
        `TRUST_PROXY=1`,
        `START_BLOCK=`,
    ];
    return lines.join("\n");
}

// ── market maker (the MM_* half of predikt-relay/.env) ─────────────────────
// Reuses the relay's chain/exchange env; only the MM_* vars are added here.
export function marketMakerEnvBlock(a) {
    const lines = [
        `# predikt-relay/.env (market maker half) — reuses CHAIN_ID/RPC_URL/`,
        `# EXCHANGE_ADDRESS/USDC_ADDRESS/CTF_ADDRESS from the relay block above.`,
        `# MM key is a NORMAL user account, distinct from OPERATOR_PK. Keep it secret.`,
        `MM_PRIVATE_KEY=${SECRET}`,
        `RELAY_URL=http://localhost:8787`,
        `# Comma-separated outcome token ids and/or oracle market ids to make.`,
        `MM_MARKETS=`,
        `MM_SPREAD_BPS=100`,
        `MM_ORDER_SIZE=10`,
        `MM_LEVELS=3`,
        `MM_REFRESH_MS=30000`,
        `MM_MINT_SETS=false`,
    ];
    return lines.join("\n");
}

export function allEnvBlocks(a) {
    return (
        `\n===== ENV BLOCK 1/3 — oracle/web/.env.local =====\n\n` +
        webEnvBlock(a) +
        `\n\n===== ENV BLOCK 2/3 — predikt-relay/.env (relay operator) =====\n\n` +
        relayEnvBlock(a) +
        `\n\n===== ENV BLOCK 3/3 — predikt-relay/.env (market maker) =====\n\n` +
        marketMakerEnvBlock(a) +
        `\n`
    );
}
