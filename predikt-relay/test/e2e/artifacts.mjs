// Load the REAL compiled contract artifacts from the ctf-exchange repo.
// - CTFExchange + USDC mock come from forge's `out/` build output.
// - ConditionalTokens comes from the repo's checked-in `artifacts/` bytecode
//   (the same file the repo's own tests deploy via Deployer.ConditionalTokens()).
// No re-compilation, no mocks beyond the repo's own USDC + ConditionalTokens.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// predikt-relay/test/e2e -> predikt-contracts/ctf-exchange
export const CTF_EXCHANGE_DIR = resolve(
    __dirname,
    "../../../predikt-contracts/ctf-exchange",
);

function readJson(rel) {
    return JSON.parse(readFileSync(resolve(CTF_EXCHANGE_DIR, rel), "utf8"));
}

function bytecodeOf(artifact) {
    const b = artifact.bytecode;
    if (typeof b === "string") return b.startsWith("0x") ? b : `0x${b}`;
    const obj = b?.object ?? b?.bytecode;
    if (!obj) throw new Error("artifact has no bytecode");
    return obj.startsWith("0x") ? obj : `0x${obj}`;
}

export function loadArtifacts() {
    const exchange = readJson("out/CTFExchange.sol/CTFExchange.json");
    const usdc = readJson("out/USDC.sol/USDC.json");
    const ct = readJson("artifacts/ConditionalTokens.json");

    return {
        exchange: { abi: exchange.abi, bytecode: bytecodeOf(exchange) },
        usdc: { abi: usdc.abi, bytecode: bytecodeOf(usdc) },
        conditionalTokens: { abi: ct.abi, bytecode: bytecodeOf(ct) },
    };
}
