// Load the REAL compiled contract artifacts used by the FPMM e2e.
//
//   - FPMMDeterministicFactory + FixedProductMarketMaker come from THIS repo's
//     own forge `out/` build (predikt-contracts/fpmm/out). These are the real
//     Gnosis-derived AMM sources compiled with solc 0.5.x — no re-implementation.
//   - USDC mock (6dp) + ConditionalTokens are reused from the sibling
//     ctf-exchange repo exactly like the relay e2e does: USDC from its forge
//     `out/`, ConditionalTokens from its checked-in `artifacts/` bytecode.
//
// No re-compilation happens here; if `out/` is missing, run `forge build` in
// the fpmm directory first (the npm `e2e:amm` script does this for you).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// predikt-contracts/fpmm/test-e2e -> predikt-contracts/fpmm
export const FPMM_DIR = resolve(__dirname, "..");
// predikt-contracts/fpmm/test-e2e -> predikt-contracts/ctf-exchange
export const CTF_EXCHANGE_DIR = resolve(__dirname, "../../ctf-exchange");

function readJson(baseDir, rel) {
    return JSON.parse(readFileSync(resolve(baseDir, rel), "utf8"));
}

function bytecodeOf(artifact) {
    const b = artifact.bytecode;
    if (typeof b === "string") return b.startsWith("0x") ? b : `0x${b}`;
    const obj = b?.object ?? b?.bytecode;
    if (!obj) throw new Error("artifact has no bytecode");
    return obj.startsWith("0x") ? obj : `0x${obj}`;
}

export function loadArtifacts() {
    // Predikt's OWN FPMM build output.
    const factory = readJson(
        FPMM_DIR,
        "out/FPMMDeterministicFactory.sol/FPMMDeterministicFactory.json",
    );
    const fpmm = readJson(
        FPMM_DIR,
        "out/FixedProductMarketMaker.sol/FixedProductMarketMaker.json",
    );

    // Shared primitives from the ctf-exchange repo (same ones the relay e2e uses).
    const usdc = readJson(CTF_EXCHANGE_DIR, "out/USDC.sol/USDC.json");
    const ct = readJson(CTF_EXCHANGE_DIR, "artifacts/ConditionalTokens.json");

    return {
        factory: { abi: factory.abi, bytecode: bytecodeOf(factory) },
        // The FPMM ABI is what we call on the *cloned* pool address.
        fpmm: { abi: fpmm.abi, bytecode: bytecodeOf(fpmm) },
        usdc: { abi: usdc.abi, bytecode: bytecodeOf(usdc) },
        conditionalTokens: { abi: ct.abi, bytecode: bytecodeOf(ct) },
    };
}
