// ─────────────────────────────────────────────────────────────────────────
// Real, already-deployed primitive addresses per chain, mirrored 1:1 from
// predikt-contracts/DEPLOY.md ("Real primitive addresses" tables). These are
// the constructor inputs to the two forge deploy scripts and the FPMM factory.
//
// NOTHING here is a secret. These are public, on-chain primitive addresses.
// The deployer's PRIVATE_KEY is NEVER stored here or written to disk — it is
// read from the environment at run time and passed straight to forge/cast.
//
// Sources (see DEPLOY.md for the full citations):
//   - Polygon 137 CTF/USDC/UMA/factories  — PolygonScan + UMA networks/137.json
//   - Amoy   80002 CTF/USDC/UMA            — UMA networks/80002.json + PM mirror
// ─────────────────────────────────────────────────────────────────────────

export const CHAINS = {
    polygon: {
        key: "polygon",
        chainId: 137,
        label: "Polygon mainnet",
        // Default public RPC (override with RPC env). Free, no key required.
        defaultRpc: "https://polygon-rpc.com",
        primitives: {
            // Gnosis ConditionalTokens (verified "Polymarket: Conditional Tokens")
            ctf: "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045",
            // Collateral — native Circle USDC (the web app default; USE THIS so the
            // exchange collateral matches NEXT_PUBLIC_ONCHAIN_USDC out of the box).
            usdc: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
            usdcDecimals: 6,
            // UMA
            umaFinder: "0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64",
            umaOptimisticOracle: "0xeE3Afe347D5C74317041E2618C49534dAf887c24",
            // Polymarket proxy-wallet + Gnosis Safe factories (exchange constructor)
            proxyFactory: "0xaB45c5A4B0c941a2F231C04C3f49182e1A254052",
            safeFactory: "0xaacFeEa03eb1561C4e67d661e40682Bd20E3541b",
        },
    },
    amoy: {
        key: "amoy",
        chainId: 80002,
        label: "Polygon Amoy testnet",
        defaultRpc: "https://rpc-amoy.polygon.technology",
        primitives: {
            ctf: "0x69308FB512518e39F9b16112fA8d994F4e2Bf8bB",
            usdc: "0x9c4e1703476e875070ee25b56a58b008cfb8fa78",
            usdcDecimals: 6,
            umaFinder: "0x28077B47Cd03326De7838926A63699849DD4fa87",
            umaOptimisticOracle: "0x38fAc33bD20D4c4Cce085C0f347153C06CbA2968",
            // No published Polymarket Proxy Factory on Amoy. The exchange accepts
            // address(0) for the proxy/safe factories (relay e2e deploys it with
            // 0,0); signature-type paths that need them are simply unavailable.
            proxyFactory: "0x0000000000000000000000000000000000000000",
            safeFactory: "0xaacFeEa03eb1561C4e67d661e40682Bd20E3541b",
        },
    },
};

export function resolveChain(name) {
    const c = CHAINS[name];
    if (!c) {
        throw new Error(
            `unknown chain '${name}'. Supported: ${Object.keys(CHAINS).join(", ")}`,
        );
    }
    return c;
}
