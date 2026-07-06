// ─────────────────────────────────────────────────────────────────────────
// Load the REAL compiled contract artifacts for the full Predikt stack.
//
// Everything here is reused from the existing repos' own forge/checked-in
// build output — NOTHING is re-compiled or re-implemented:
//
//   - USDC mock (6dp)           ← predikt-contracts/ctf-exchange/out
//   - ConditionalTokens         ← predikt-contracts/ctf-exchange/artifacts
//   - CTFExchange               ← predikt-contracts/ctf-exchange/out
//   - FPMMDeterministicFactory  ← predikt-contracts/fpmm/out (Predikt's AMM)
//   - FixedProductMarketMaker   ← predikt-contracts/fpmm/out (clone ABI)
//   - UmaCtfAdapter + UMA stack ← predikt-contracts/uma-ctf-adapter/{out,artifacts}
//
// The UMA "stack" (Finder / Store / IdentifierWhitelist / AddressWhitelist /
// OptimisticOracleV2) ships as checked-in precompiled bytecode in the adapter
// repo's artifacts/ dir — the exact bytecode its own forge tests deploy via
// vm.getCode(). OracleStub comes from the adapter's forge out/.
// ─────────────────────────────────────────────────────────────────────────

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// demo/ -> prediction/
const ROOT = resolve(__dirname, "..");
export const CTF_EXCHANGE_DIR = resolve(ROOT, "predikt-contracts/ctf-exchange");
export const FPMM_DIR = resolve(ROOT, "predikt-contracts/fpmm");
export const UMA_DIR = resolve(ROOT, "predikt-contracts/uma-ctf-adapter");

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

function pack(artifact) {
    return { abi: artifact.abi, bytecode: bytecodeOf(artifact) };
}

export function loadArtifacts() {
    // ── Core CLOB primitives (ctf-exchange repo) ────────────────────────────
    const usdc = readJson(CTF_EXCHANGE_DIR, "out/USDC.sol/USDC.json");
    const ct = readJson(CTF_EXCHANGE_DIR, "artifacts/ConditionalTokens.json");
    const exchange = readJson(CTF_EXCHANGE_DIR, "out/CTFExchange.sol/CTFExchange.json");

    // ── AMM (Predikt's own fpmm repo) ───────────────────────────────────────
    const factory = readJson(
        FPMM_DIR,
        "out/FPMMDeterministicFactory.sol/FPMMDeterministicFactory.json",
    );
    const fpmm = readJson(
        FPMM_DIR,
        "out/FixedProductMarketMaker.sol/FixedProductMarketMaker.json",
    );

    // ── UMA CTF Adapter + its optimistic-oracle stack (uma-ctf-adapter repo) ─
    const adapter = readJson(UMA_DIR, "out/UmaCtfAdapter.sol/UmaCtfAdapter.json");
    const oracleStub = readJson(UMA_DIR, "out/OracleStub.sol/OracleStub.json");
    // Precompiled UMA bytecode (checked into the adapter repo's artifacts/).
    const finder = readJson(UMA_DIR, "artifacts/Finder.json");
    const store = readJson(UMA_DIR, "artifacts/Store.json");
    const identifierWhitelist = readJson(UMA_DIR, "artifacts/IdentifierWhitelist.json");
    const addressWhitelist = readJson(UMA_DIR, "artifacts/AddressWhitelist.json");
    const optimisticOracle = readJson(UMA_DIR, "artifacts/OptimisticOracleV2.json");

    return {
        usdc: pack(usdc),
        conditionalTokens: pack(ct),
        exchange: pack(exchange),
        factory: pack(factory),
        fpmm: pack(fpmm),
        adapter: pack(adapter),
        oracleStub: pack(oracleStub),
        finder: pack(finder),
        store: pack(store),
        identifierWhitelist: pack(identifierWhitelist),
        addressWhitelist: pack(addressWhitelist),
        optimisticOracle: pack(optimisticOracle),
    };
}
