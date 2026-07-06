// ─────────────────────────────────────────────────────────────────────────
// Deploy an FPMM (instant-liquidity AMM) pool for an existing Conditional-Tokens
// condition, using Predikt's own FPMMDeterministicFactory.
//
// This reuses the factory's native create pattern (create2FixedProductMarketMaker),
// which in ONE transaction: clones a FixedProductMarketMaker, wires it to the
// given ConditionalTokens + collateral + conditionId, and (if INITIAL_FUNDS > 0)
// pulls the collateral and calls addFunding to seed YES/NO liquidity. The pool
// address is recovered from the FixedProductMarketMakerCreation event.
//
// Solidity ^0.5.1 contracts can't share a forge-std (^0.8) Script, so the deploy
// driver is plain Node + viem — same toolchain as the e2e. It is fully
// parameterized by env so it works on anvil, a testnet, or mainnet.
//
// Required env:
//   RPC_URL              JSON-RPC endpoint
//   DEPLOYER_PK          0x-private key that sends txs & funds the pool
//   CTF_ADDRESS          deployed ConditionalTokens address
//   COLLATERAL_ADDRESS   ERC20 collateral (e.g. USDC)
//   CONDITION_ID         0x… conditionId (from prepareCondition)
//
// Optional env:
//   FACTORY_ADDRESS      existing FPMMDeterministicFactory; if unset, one is deployed
//   FEE_BPS              pool fee in basis points (default 200 = 2%)
//   INITIAL_FUNDS        collateral units to seed (human, e.g. "1000"); default 0 (no seed)
//   COLLATERAL_DECIMALS  decimals of the collateral (default read from chain)
//   DISTRIBUTION_HINT    comma list, e.g. "1,1" for 50/50; default equal weights
//   SALT_NONCE           create2 salt nonce (default 1)
//   CHAIN_ID             chain id (default read from chain)
//
// Usage:
//   RPC_URL=… DEPLOYER_PK=… CTF_ADDRESS=… COLLATERAL_ADDRESS=… CONDITION_ID=… \
//   INITIAL_FUNDS=1000 FEE_BPS=200 node script/deploy-fpmm.mjs
// ─────────────────────────────────────────────────────────────────────────

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
    createPublicClient,
    createWalletClient,
    http,
    parseUnits,
    formatUnits,
    parseEventLogs,
    maxUint256,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FPMM_DIR = resolve(__dirname, "..");

function req(name) {
    const v = process.env[name];
    if (!v) throw new Error(`missing required env: ${name}`);
    return v;
}

function readArtifact(rel) {
    const j = JSON.parse(readFileSync(resolve(FPMM_DIR, rel), "utf8"));
    const b = j.bytecode;
    const bytecode = typeof b === "string" ? b : b?.object;
    return { abi: j.abi, bytecode: bytecode?.startsWith?.("0x") ? bytecode : `0x${bytecode}` };
}

const ERC20_ABI = [
    { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
    { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
    { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
];

async function main() {
    const RPC_URL = req("RPC_URL");
    const DEPLOYER_PK = req("DEPLOYER_PK");
    const CTF_ADDRESS = req("CTF_ADDRESS");
    const COLLATERAL_ADDRESS = req("COLLATERAL_ADDRESS");
    const CONDITION_ID = req("CONDITION_ID");

    const FEE_BPS = BigInt(process.env.FEE_BPS ?? "200"); // 2% default
    const SALT_NONCE = BigInt(process.env.SALT_NONCE ?? "1");

    const account = privateKeyToAccount(DEPLOYER_PK);
    const publicClient = createPublicClient({ transport: http(RPC_URL) });
    const chainId = process.env.CHAIN_ID ? Number(process.env.CHAIN_ID) : await publicClient.getChainId();
    const chain = {
        id: chainId,
        name: `chain-${chainId}`,
        nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: [RPC_URL] } },
    };
    const walletClient = createWalletClient({ account, chain, transport: http(RPC_URL) });

    const collDecimals = process.env.COLLATERAL_DECIMALS
        ? Number(process.env.COLLATERAL_DECIMALS)
        : Number(await publicClient.readContract({ address: COLLATERAL_ADDRESS, abi: ERC20_ABI, functionName: "decimals" }));

    // fee is an 18-dp fraction: FEE_BPS/10000 * 1e18
    const fee = (FEE_BPS * 10n ** 18n) / 10000n;

    const initialFundsHuman = process.env.INITIAL_FUNDS ?? "0";
    const initialFunds = parseUnits(initialFundsHuman, collDecimals);

    // distributionHint (only used on the initial funding). Empty => uniform.
    let distributionHint = [];
    if (process.env.DISTRIBUTION_HINT) {
        distributionHint = process.env.DISTRIBUTION_HINT.split(",").map((s) => BigInt(s.trim()));
    } else if (initialFunds > 0n) {
        // default 50/50 for a 2-outcome condition
        distributionHint = [1n, 1n];
    }

    const factoryArtifact = readArtifact("out/FPMMDeterministicFactory.sol/FPMMDeterministicFactory.json");

    console.log("=== Deploy FPMM pool ===");
    console.log(`chainId=${chainId} deployer=${account.address}`);
    console.log(`CTF=${CTF_ADDRESS} collateral=${COLLATERAL_ADDRESS} (${collDecimals}dp)`);
    console.log(`conditionId=${CONDITION_ID}`);
    console.log(`fee=${FEE_BPS}bps (${formatUnits(fee, 16)}%)  initialFunds=${initialFundsHuman}`);

    const send = async (params) => {
        const hash = await walletClient.writeContract(params);
        const rcpt = await publicClient.waitForTransactionReceipt({ hash });
        if (rcpt.status !== "success") throw new Error(`tx reverted: ${params.functionName ?? "deploy"}`);
        return rcpt;
    };

    // 1) factory (deploy if not provided)
    let factoryAddr = process.env.FACTORY_ADDRESS;
    if (!factoryAddr) {
        const hash = await walletClient.deployContract({ abi: factoryArtifact.abi, bytecode: factoryArtifact.bytecode, args: [] });
        const rcpt = await publicClient.waitForTransactionReceipt({ hash });
        factoryAddr = rcpt.contractAddress;
        console.log(`deployed FPMMDeterministicFactory=${factoryAddr}`);
    } else {
        console.log(`using existing factory=${factoryAddr}`);
    }

    // 2) approve collateral to the factory so it can pull INITIAL_FUNDS
    if (initialFunds > 0n) {
        await send({
            address: COLLATERAL_ADDRESS, abi: ERC20_ABI, functionName: "approve",
            args: [factoryAddr, maxUint256],
        });
    }

    // 3) create the pool (and seed it in the same tx if initialFunds > 0)
    const rcpt = await send({
        address: factoryAddr,
        abi: factoryArtifact.abi,
        functionName: "create2FixedProductMarketMaker",
        args: [SALT_NONCE, CTF_ADDRESS, COLLATERAL_ADDRESS, [CONDITION_ID], fee, initialFunds, distributionHint],
    });

    const logs = parseEventLogs({ abi: factoryArtifact.abi, eventName: "FixedProductMarketMakerCreation", logs: rcpt.logs });
    if (logs.length !== 1) throw new Error(`expected 1 creation event, got ${logs.length}`);
    const poolAddr = logs[0].args.fixedProductMarketMaker;

    console.log("\n=== RESULT ===");
    console.log(`FPMM_POOL=${poolAddr}`);
    console.log(`FPMM_FACTORY=${factoryAddr}`);
    console.log(`tx=${rcpt.transactionHash}`);
    if (initialFunds > 0n) {
        console.log(`seeded with ${initialFundsHuman} collateral (hint=[${distributionHint.join(",")}])`);
    } else {
        console.log(`created UNSEEDED — call addFunding on ${poolAddr} to add liquidity (see DEPLOY.md)`);
    }
}

main().catch((err) => {
    console.error("[deploy-fpmm ERROR]", err?.shortMessage ?? err?.message ?? err);
    process.exitCode = 1;
});
