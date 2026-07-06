// ─────────────────────────────────────────────────────────────────────────
// Predikt ONE-COMMAND local full-stack demo — REAL anvil, REAL deploys, REAL
// relay + market maker, REAL on-chain settlement. No mocks beyond the repos'
// own USDC/ConditionalTokens/UMA test stubs; nothing is faked.
//
// Boots the ENTIRE on-chain stack together, proves it works with a live
// router self-check (quote AMM vs CLOB → execute the better venue → assert the
// on-chain fill), then stays up for manual poking until Ctrl-C, tearing down
// anvil + relay cleanly.
//
// What it boots (once, on a single anvil):
//   • USDC mock (6dp)               ← ctf-exchange
//   • ConditionalTokens             ← ctf-exchange
//   • CTFExchange                   ← ctf-exchange   (the CLOB settlement layer)
//   • FPMMDeterministicFactory      ← fpmm           (the instant-liquidity AMM)
//   • UMA stack + UmaCtfAdapter     ← uma-ctf-adapter (real optimistic-oracle
//                                      resolution path; a real UMA-backed
//                                      condition is initialized on-chain)
//
// Then it:
//   • prepareCondition + registerToken(yes,no) on the exchange
//   • grants the relay operator the exchange operator role
//   • seeds an FPMM pool via create2 + addFunding (instant AMM liquidity)
//   • starts the relay HTTP server (predikt-relay/dist/server.js) against anvil
//   • seeds the CLOB by posting a couple of real signed maker orders
//   • prints the RELAY URL + the exact env block to paste into
//     oracle/web/.env.local (NEXT_PUBLIC_ONCHAIN_* + RELAY_URL)
//   • runs a router self-check taker buy and asserts the fill on-chain
//   • stays up until Ctrl-C, then kills anvil + relay
//
// Env knobs:
//   DEMO_SELFCHECK_ONLY=1  → boot, run the self-check, tear down, exit (CI/timebox)
// ─────────────────────────────────────────────────────────────────────────

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import {
    createPublicClient,
    createWalletClient,
    http,
    parseUnits,
    formatUnits,
    parseEventLogs,
    maxUint256,
    zeroAddress,
    zeroHash,
} from "viem";
import { privateKeyToAccount, mnemonicToAccount } from "viem/accounts";
import { loadArtifacts } from "./artifacts.mjs";
import { ExchangeOrderBuilder, OrderSide, SignatureType } from "@predikt/orders";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const RELAY_DIR = resolve(ROOT, "predikt-relay");

// ── Config ──────────────────────────────────────────────────────────────────
const ANVIL_MNEMONIC = "test test test test test test test test test test test junk";
const RPC_PORT = Number(process.env.DEMO_RPC_PORT || 8545);
const RPC_URL = `http://127.0.0.1:${RPC_PORT}`;
const CHAIN_ID = 31337;
const RELAY_PORT = Number(process.env.DEMO_RELAY_PORT || 8787);
const RELAY_URL = `http://127.0.0.1:${RELAY_PORT}`;
const SELFCHECK_ONLY = process.env.DEMO_SELFCHECK_ONLY === "1";

// A distinct questionId for the CLOB/AMM tradeable condition (deployer is its
// oracle so the demo can resolve it directly if a poker wants to).
const QUESTION_ID = "0x1234000000000000000000000000000000000000000000000000000000000000";

// UMA: identifier + a human-readable ancillary question for the adapter path.
const UMA_IDENTIFIER = "0x5945535f4f525f4e4f5f51554552590000000000000000000000000000000000"; // "YES_OR_NO_QUERY"
const UMA_ANCILLARY =
    "q: title: Will Predikt ship its local full-stack demo?, description: Resolve YES if the demo boots the full stack.";

// Anvil funded accounts (default mnemonic).
const KEYS = derivePrivateKeys(ANVIL_MNEMONIC, 5);
const DEPLOYER = KEYS[0]; // deploys everything; oracle for the tradeable condition
const OPERATOR = KEYS[1]; // relay operator (matchOrders msg.sender)
const MAKER = KEYS[2]; // CLOB market maker: posts resting SELL orders
const TAKER = KEYS[3]; // router self-check taker (buys YES)
const CREATOR = KEYS[4]; // seeds the FPMM pool

// ── Result tracking ──────────────────────────────────────────────────────────
const results = [];
function record(step, pass, detail) {
    results.push({ step, pass, detail });
    const tag = pass ? "PASS" : "FAIL";
    console.log(`[${tag}] ${step}${detail ? ` — ${detail}` : ""}`);
}
function assert(cond, step, detail) {
    record(step, !!cond, detail);
    if (!cond) throw new Error(`assertion failed: ${step} — ${detail ?? ""}`);
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function derivePrivateKeys(mnemonic, n) {
    const out = [];
    for (let i = 0; i < n; i++) {
        const acct = mnemonicToAccount(mnemonic, { addressIndex: i });
        out.push({
            address: acct.address,
            pk: `0x${Buffer.from(acct.getHdKey().privateKey).toString("hex")}`,
        });
    }
    return out;
}

const CHAIN = {
    id: CHAIN_ID,
    name: "anvil",
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [RPC_URL] } },
};

let anvilProc = null;
let relayProc = null;
let tmpDataDir = null;
let tornDown = false;

function startAnvil() {
    return new Promise((resolveP, rejectP) => {
        anvilProc = spawn(
            "anvil",
            ["--port", String(RPC_PORT), "--mnemonic", ANVIL_MNEMONIC, "--chain-id", String(CHAIN_ID), "--silent"],
            { stdio: ["ignore", "pipe", "pipe"] },
        );
        anvilProc.on("error", rejectP);
        setTimeout(() => resolveP(), 800);
    });
}

async function waitForRpc(publicClient, tries = 40) {
    for (let i = 0; i < tries; i++) {
        try {
            await publicClient.getBlockNumber();
            return true;
        } catch {
            await sleep(250);
        }
    }
    throw new Error("anvil RPC never became reachable");
}

async function waitForRelay(tries = 80) {
    for (let i = 0; i < tries; i++) {
        try {
            const r = await fetch(`${RELAY_URL}/health`);
            if (r.ok) return await r.json();
        } catch {
            /* retry */
        }
        await sleep(300);
    }
    throw new Error("relay /health never became reachable");
}

function startRelay(addrs) {
    tmpDataDir = mkdtempSync(resolve(tmpdir(), "predikt-demo-"));
    const env = {
        ...process.env,
        PORT: String(RELAY_PORT),
        CHAIN_ID: String(CHAIN_ID),
        RPC_URL,
        EXCHANGE_ADDRESS: addrs.exchange,
        USDC_ADDRESS: addrs.usdc,
        CTF_ADDRESS: addrs.ct,
        OPERATOR_PK: OPERATOR.pk,
        DATABASE_PATH: resolve(tmpDataDir, "relay.db"),
        RELAY_ALLOWED_ORIGINS: "http://localhost:3000",
        START_BLOCK: "0",
    };
    const distEntry = resolve(RELAY_DIR, "dist/server.js");
    const spawnArgs = existsSync(distEntry)
        ? [distEntry]
        : ["--experimental-strip-types", "src/server.ts"];
    relayProc = spawn(process.execPath, spawnArgs, {
        cwd: RELAY_DIR,
        env,
        stdio: ["ignore", "pipe", "pipe"],
    });
    relayProc.stdout.on("data", (d) => process.stdout.write(`  [relay] ${d}`));
    relayProc.stderr.on("data", (d) => process.stderr.write(`  [relay:err] ${d}`));
}

function teardown() {
    if (tornDown) return;
    tornDown = true;
    if (relayProc && !relayProc.killed) relayProc.kill("SIGKILL");
    if (anvilProc && !anvilProc.killed) anvilProc.kill("SIGKILL");
    if (tmpDataDir) {
        try {
            rmSync(tmpDataDir, { recursive: true, force: true });
        } catch {
            /* ignore */
        }
    }
}

async function deploy(walletClient, publicClient, artifact, args, label) {
    const hash = await walletClient.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode, args });
    const rcpt = await publicClient.waitForTransactionReceipt({ hash });
    if (!rcpt.contractAddress) throw new Error(`${label} deploy produced no address`);
    return rcpt.contractAddress;
}

async function txWait(publicClient, walletClient, params) {
    const hash = await walletClient.writeContract(params);
    const rcpt = await publicClient.waitForTransactionReceipt({ hash });
    if (rcpt.status !== "success") throw new Error(`tx reverted: ${JSON.stringify(params.functionName)}`);
    return rcpt;
}

async function post(path, body) {
    const r = await fetch(`${RELAY_URL}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });
    const json = await r.json().catch(() => ({}));
    return { status: r.status, json };
}

async function getJson(path) {
    const r = await fetch(`${RELAY_URL}${path}`);
    return { status: r.status, json: await r.json().catch(() => ({})) };
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
    console.log("╔══════════════════════════════════════════════════════════════╗");
    console.log("║  Predikt — ONE-COMMAND local full-stack demo (REAL on-chain)   ║");
    console.log("╚══════════════════════════════════════════════════════════════╝");
    console.log(`deployer=${DEPLOYER.address} (deploys all; oracle for tradeable condition)`);
    console.log(`operator=${OPERATOR.address} (relay matcher)`);
    console.log(`maker   =${MAKER.address} (CLOB market maker)`);
    console.log(`creator =${CREATOR.address} (FPMM pool)`);
    console.log(`taker   =${TAKER.address} (router self-check)`);

    const artifacts = loadArtifacts();

    // 1) anvil ────────────────────────────────────────────────────────────────
    await startAnvil();
    const publicClient = createPublicClient({ transport: http(RPC_URL) });
    await waitForRpc(publicClient);
    const bn = await publicClient.getBlockNumber();
    record("1. anvil started", true, `chainId=${CHAIN_ID} block=${bn} rpc=${RPC_URL}`);

    const wc = (key) => createWalletClient({ account: privateKeyToAccount(key.pk), chain: CHAIN, transport: http(RPC_URL) });
    const deployerWc = wc(DEPLOYER);
    const makerWc = wc(MAKER);
    const takerWc = wc(TAKER);
    const creatorWc = wc(CREATOR);

    // 2) deploy the FULL contract set ──────────────────────────────────────────
    const usdcAddr = await deploy(deployerWc, publicClient, artifacts.usdc, [], "USDC");
    const ctAddr = await deploy(deployerWc, publicClient, artifacts.conditionalTokens, [], "ConditionalTokens");
    const exchangeAddr = await deploy(
        deployerWc, publicClient, artifacts.exchange,
        [usdcAddr, ctAddr, zeroAddress, zeroAddress], "CTFExchange",
    );
    const factoryAddr = await deploy(deployerWc, publicClient, artifacts.factory, [], "FPMMDeterministicFactory");

    // ── UMA optimistic-oracle stack + adapter (real resolution path) ──────────
    // The Finder must be WIRED before the adapter is constructed — the
    // UmaCtfAdapter constructor reads Finder.getImplementationAddress(
    // "CollateralWhitelist"). So: deploy the UMA components, register each in the
    // Finder + whitelist USDC + the identifier, THEN deploy the adapter.
    const finderAddr = await deploy(deployerWc, publicClient, artifacts.finder, [], "Finder");
    const storeAddr = await deploy(deployerWc, publicClient, artifacts.store, [], "Store");
    const idWhitelistAddr = await deploy(deployerWc, publicClient, artifacts.identifierWhitelist, [], "IdentifierWhitelist");
    const addrWhitelistAddr = await deploy(deployerWc, publicClient, artifacts.addressWhitelist, [], "AddressWhitelist");
    const oracleStubAddr = await deploy(deployerWc, publicClient, artifacts.oracleStub, [], "OracleStub");
    // OptimisticOracleV2(liveness, finder, timerAddress=0)
    const ooAddr = await deploy(
        deployerWc, publicClient, artifacts.optimisticOracle,
        [7200n, finderAddr, zeroAddress], "OptimisticOracleV2",
    );

    // Wire the Finder + whitelists (mirrors the adapter repo's own test setup).
    await txWait(publicClient, deployerWc, { address: addrWhitelistAddr, abi: artifacts.addressWhitelist.abi, functionName: "addToWhitelist", args: [usdcAddr] });
    await txWait(publicClient, deployerWc, { address: idWhitelistAddr, abi: artifacts.identifierWhitelist.abi, functionName: "addSupportedIdentifier", args: [UMA_IDENTIFIER] });
    await txWait(publicClient, deployerWc, { address: storeAddr, abi: artifacts.store.abi, functionName: "setFinalFee", args: [usdcAddr, { rawValue: 1500000000n }] });
    const finderSet = async (name, addr) => txWait(publicClient, deployerWc, {
        address: finderAddr, abi: artifacts.finder.abi, functionName: "changeImplementationAddress",
        args: [nameToBytes32(name), addr],
    });
    await finderSet("IdentifierWhitelist", idWhitelistAddr);
    await finderSet("Store", storeAddr);
    await finderSet("OptimisticOracleV2", ooAddr);
    await finderSet("CollateralWhitelist", addrWhitelistAddr);
    await finderSet("Oracle", oracleStubAddr);

    // Now the Finder is wired — deploy the adapter (its constructor reads it).
    const adapterAddr = await deploy(
        deployerWc, publicClient, artifacts.adapter,
        [ctAddr, finderAddr, ooAddr], "UmaCtfAdapter",
    );

    record("2. full contract set deployed", true, "");
    console.log("     ── core ────────────────────────────────────────────────");
    console.log(`     USDC (6dp)               = ${usdcAddr}`);
    console.log(`     ConditionalTokens        = ${ctAddr}`);
    console.log(`     CTFExchange (CLOB)       = ${exchangeAddr}`);
    console.log(`     FPMMDeterministicFactory = ${factoryAddr}`);
    console.log("     ── UMA optimistic-oracle resolution stack ──────────────");
    console.log(`     Finder                   = ${finderAddr}`);
    console.log(`     Store                    = ${storeAddr}`);
    console.log(`     IdentifierWhitelist      = ${idWhitelistAddr}`);
    console.log(`     AddressWhitelist         = ${addrWhitelistAddr}`);
    console.log(`     OptimisticOracleV2       = ${ooAddr}`);
    console.log(`     OracleStub (DVM)         = ${oracleStubAddr}`);
    console.log(`     UmaCtfAdapter            = ${adapterAddr}`);

    const ct = { address: ctAddr, abi: artifacts.conditionalTokens.abi };
    const usdc = { address: usdcAddr, abi: artifacts.usdc.abi };
    const exchange = { address: exchangeAddr, abi: artifacts.exchange.abi };

    const readCt = (fn, args) => publicClient.readContract({ address: ctAddr, abi: ct.abi, functionName: fn, args });
    const readUsdc = (fn, args) => publicClient.readContract({ address: usdcAddr, abi: usdc.abi, functionName: fn, args });
    const readEx = (fn, args) => publicClient.readContract({ address: exchangeAddr, abi: exchange.abi, functionName: fn, args });

    const USDC = (n) => parseUnits(String(n), 6);
    const usdcDecimals = await readUsdc("decimals", []);
    assert(Number(usdcDecimals) === 6, "2a. collateral USDC is 6dp", `decimals=${usdcDecimals}`);

    // 2b) Exercise the UMA adapter (real optimistic-oracle path) ───────────────
    // The Finder + whitelists were wired above (before the adapter deploy). Now
    // initialize a REAL UMA-backed condition through the adapter — this calls
    // ctf.prepareCondition(adapter,...) AND requests a price from the OO.
    // Fund the adapter admin (deployer) with USDC + approve so initialize can
    // pull the (zero) reward; a real init requires the token be approved.
    await txWait(publicClient, deployerWc, { address: usdcAddr, abi: usdc.abi, functionName: "mint", args: [DEPLOYER.address, USDC(1000)] });
    await txWait(publicClient, deployerWc, { address: usdcAddr, abi: usdc.abi, functionName: "approve", args: [adapterAddr, maxUint256] });

    // initialize(ancillaryData, rewardToken, reward, proposalBond, liveness)
    const initRcpt = await txWait(publicClient, deployerWc, {
        address: adapterAddr, abi: artifacts.adapter.abi, functionName: "initialize",
        args: [toHexBytes(UMA_ANCILLARY), usdcAddr, 0n, 0n, 7200n],
    });
    const initLogs = parseEventLogs({ abi: artifacts.adapter.abi, eventName: "QuestionInitialized", logs: initRcpt.logs });
    assert(initLogs.length === 1, "2b. UMA adapter initialized a real question (prepareCondition + OO price request)", `questionID=${initLogs[0]?.args?.questionID}`);
    const umaConditionId = await readCt("getConditionId", [adapterAddr, initLogs[0].args.questionID, 2n]);
    record("2c. UMA-backed condition live on ConditionalTokens", true, `conditionId=${umaConditionId} oracle=UmaCtfAdapter`);

    // 3) tradeable condition: prepareCondition + register + operator role ───────
    // The CLOB + AMM demo condition uses the DEPLOYER as oracle (so a poker can
    // reportPayouts directly). Outcome-index convention matches production:
    //   YES = indexSet 1 (outcome idx 0),  NO = indexSet 2 (outcome idx 1).
    await txWait(publicClient, deployerWc, { address: ctAddr, abi: ct.abi, functionName: "prepareCondition", args: [DEPLOYER.address, QUESTION_ID, 2n] });
    const conditionId = await readCt("getConditionId", [DEPLOYER.address, QUESTION_ID, 2n]);
    const collectionYes = await readCt("getCollectionId", [zeroHash, conditionId, 1n]);
    const collectionNo = await readCt("getCollectionId", [zeroHash, conditionId, 2n]);
    const yes = await readCt("getPositionId", [usdcAddr, collectionYes]); // outcome idx 0
    const no = await readCt("getPositionId", [usdcAddr, collectionNo]); // outcome idx 1
    const OUTCOME_YES = 0;

    await txWait(publicClient, deployerWc, { address: exchangeAddr, abi: exchange.abi, functionName: "registerToken", args: [yes, no, conditionId] });
    await txWait(publicClient, deployerWc, { address: exchangeAddr, abi: exchange.abi, functionName: "addOperator", args: [OPERATOR.address] });

    const complement = await readEx("getComplement", [yes]);
    const isOp = await readEx("isOperator", [OPERATOR.address]);
    assert(complement === no, "3a. YES/NO pair registered on exchange", `complement=${complement}`);
    assert(isOp === true, "3b. relay operator granted exchange operator role", `operator=${OPERATOR.address}`);
    record("3. tradeable condition prepared + registered", true, `conditionId=${conditionId}\n     YES(idx0)=${yes}\n     NO (idx1)=${no}`);

    // 4) seed the AMM venue (FPMM pool via create2 + addFunding) ────────────────
    const SEED = USDC(1000);
    const FEE = parseUnits("0.02", 18); // 2%
    await txWait(publicClient, deployerWc, { address: usdcAddr, abi: usdc.abi, functionName: "mint", args: [CREATOR.address, SEED] });
    await txWait(publicClient, creatorWc, { address: usdcAddr, abi: usdc.abi, functionName: "approve", args: [factoryAddr, maxUint256] });
    const createRcpt = await txWait(publicClient, creatorWc, {
        address: factoryAddr, abi: artifacts.factory.abi, functionName: "create2FixedProductMarketMaker",
        args: [1n, ctAddr, usdcAddr, [conditionId], FEE, SEED, [1n, 1n]],
    });
    const creationLogs = parseEventLogs({ abi: artifacts.factory.abi, eventName: "FixedProductMarketMakerCreation", logs: createRcpt.logs });
    assert(creationLogs.length === 1, "4a. FPMM pool created + seeded via addFunding", `events=${creationLogs.length}`);
    const poolAddr = creationLogs[0].args.fixedProductMarketMaker;
    const pool = { address: poolAddr, abi: artifacts.fpmm.abi };
    const readPool = (fn, args) => publicClient.readContract({ address: poolAddr, abi: pool.abi, functionName: fn, args });
    const poolYes = await readCt("balanceOf", [poolAddr, yes]);
    const poolNo = await readCt("balanceOf", [poolAddr, no]);
    assert(poolYes === SEED && poolNo === SEED, "4b. AMM pool holds equal YES/NO liquidity", `YES=${formatUnits(poolYes, 6)} NO=${formatUnits(poolNo, 6)}`);
    record("4. AMM venue seeded (FPMM instant liquidity)", true, `pool=${poolAddr} fee=2%`);

    // 5) start the relay HTTP server against anvil ──────────────────────────────
    startRelay({ exchange: exchangeAddr, usdc: usdcAddr, ct: ctAddr });
    const health = await waitForRelay();
    assert(
        health?.data?.operator?.toLowerCase() === OPERATOR.address.toLowerCase(),
        "5. relay HTTP server up against anvil",
        `url=${RELAY_URL} operator=${health?.data?.operator} block=${health?.data?.blockNumber}`,
    );

    // 6) seed the CLOB venue with real signed maker orders ─────────────────────
    // The maker mints USDC, splits into YES+NO, approves the exchange, then posts
    // resting SELL YES orders at two price levels. These are REAL EIP-712 orders
    // signed via @predikt/orders and verified by the relay.
    await txWait(publicClient, deployerWc, { address: usdcAddr, abi: usdc.abi, functionName: "mint", args: [MAKER.address, USDC(1000)] });
    await txWait(publicClient, makerWc, { address: usdcAddr, abi: usdc.abi, functionName: "approve", args: [ctAddr, maxUint256] });
    await txWait(publicClient, makerWc, { address: ctAddr, abi: ct.abi, functionName: "splitPosition", args: [usdcAddr, zeroHash, conditionId, [1n, 2n], USDC(500)] });
    await txWait(publicClient, makerWc, { address: ctAddr, abi: ct.abi, functionName: "setApprovalForAll", args: [exchangeAddr, true] });
    await txWait(publicClient, makerWc, { address: usdcAddr, abi: usdc.abi, functionName: "approve", args: [exchangeAddr, maxUint256] });

    const makerBuilder = new ExchangeOrderBuilder(exchangeAddr, CHAIN_ID, wc(MAKER));
    // Two resting SELL YES levels: 100 YES @ 0.55 and 100 YES @ 0.60.
    // Both use nonce "0": the CTFExchange tracks a single current nonce per maker
    // (0 until explicitly bumped), so multiple resting orders share it.
    const restingLevels = [
        { shares: 100, price: 0.55, nonce: "0" },
        { shares: 100, price: 0.6, nonce: "0" },
    ];
    let posted = 0;
    for (const lvl of restingLevels) {
        const sharesRaw = USDC(lvl.shares);
        const usdcRaw = USDC(lvl.shares * lvl.price);
        const sell = await makerBuilder.buildSignedOrder({
            maker: MAKER.address, signer: MAKER.address, taker: zeroAddress,
            tokenId: yes.toString(), makerAmount: sharesRaw.toString(), takerAmount: usdcRaw.toString(),
            side: OrderSide.SELL, feeRateBps: "0", nonce: lvl.nonce, signatureType: SignatureType.EOA, expiration: "0",
        });
        const res = await post("/orders", sell);
        if (res.status === 201) posted++;
        else console.log(`     [warn] resting SELL @ ${lvl.price} rejected: http=${res.status} ${JSON.stringify(res.json?.error ?? "")}`);
    }
    assert(posted === restingLevels.length, "6. CLOB venue seeded with resting maker orders", `${posted} SELL levels @ 0.55 / 0.60`);

    // Confirm the book is queryable (what oracle/web reads).
    const book = await getJson(`/book?tokenId=${yes.toString()}`);
    const bestAsk = book.json?.data?.asks?.[0];
    record("6a. CLOB book live", true, `asks=${book.json?.data?.asks?.length ?? 0} bestAsk=${bestAsk ? formatUnits(BigInt(bestAsk.priceWad), 18) : "n/a"}`);

    // ── Env block for oracle/web/.env.local ────────────────────────────────────
    printEnvBlock({
        usdc: usdcAddr, ct: ctAddr, exchange: exchangeAddr, factory: factoryAddr,
        adapter: adapterAddr, conditionId, yes, no, poolAddr,
    });

    // 7) ROUTER SELF-CHECK — quote AMM vs CLOB, execute the better, assert fill ─
    // This is the exact routing decision oracle/web makes: compare the effective
    // price of buying YES on the AMM against the best CLOB ask, then execute the
    // cheaper venue. We prove it end-to-end on-chain.
    await routerSelfCheck({
        publicClient, wc, readCt, readUsdc, readPool, getJson, post,
        usdcAddr, ctAddr, exchangeAddr, poolAddr, yes, OUTCOME_YES,
        deployerWc, takerWc, artifacts, ct, usdc, pool,
    });

    console.log("\n=== SUMMARY ===");
    for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.step}`);
    const failed = results.filter((r) => !r.pass);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
    if (failed.length) {
        process.exitCode = 1;
        return;
    }

    if (SELFCHECK_ONLY) {
        console.log("\nDEMO_SELFCHECK_ONLY=1 → self-check complete, tearing down.");
        return;
    }

    // 8) stay up for manual poking until Ctrl-C ─────────────────────────────────
    console.log("\n╔══════════════════════════════════════════════════════════════╗");
    console.log("║  STACK IS LIVE — poke away. Ctrl-C to tear down.               ║");
    console.log("╚══════════════════════════════════════════════════════════════╝");
    console.log(`  RPC   : ${RPC_URL}   (chainId ${CHAIN_ID}, anvil default mnemonic)`);
    console.log(`  RELAY : ${RELAY_URL}   (GET /health, /book?tokenId=, POST /orders)`);
    console.log(`  AMM   : FPMM pool ${poolAddr}`);
    console.log(`  Try   : curl ${RELAY_URL}/health`);
    console.log(`          curl "${RELAY_URL}/book?tokenId=${yes.toString()}"`);
    console.log(`          cast call ${poolAddr} "calcBuyAmount(uint256,uint256)" 100000000 0 --rpc-url ${RPC_URL}`);
    await new Promise(() => {}); // block until SIGINT
}

// ── Router self-check ─────────────────────────────────────────────────────────
async function routerSelfCheck(ctx) {
    const {
        publicClient, wc, readCt, readUsdc, readPool, getJson, post,
        usdcAddr, ctAddr, exchangeAddr, poolAddr, yes, OUTCOME_YES,
        deployerWc, takerWc, artifacts, ct, usdc, pool,
    } = ctx;
    const USDC = (n) => parseUnits(String(n), 6);
    const INVEST = USDC(50); // taker wants to buy ~50 USDC of YES

    // Fund + approve the taker for BOTH venues.
    await txWait(publicClient, deployerWc, { address: usdcAddr, abi: usdc.abi, functionName: "mint", args: [TAKER.address, USDC(1000)] });
    await txWait(publicClient, takerWc, { address: usdcAddr, abi: usdc.abi, functionName: "approve", args: [poolAddr, maxUint256] });
    await txWait(publicClient, takerWc, { address: usdcAddr, abi: usdc.abi, functionName: "approve", args: [exchangeAddr, maxUint256] });
    await txWait(publicClient, takerWc, { address: ctAddr, abi: ct.abi, functionName: "setApprovalForAll", args: [exchangeAddr, true] });

    // ── Quote the AMM: how many YES does INVEST buy? → effective price ─────────
    const ammYesOut = await readPool("calcBuyAmount", [INVEST, BigInt(OUTCOME_YES)]);
    const ammPriceWad = (INVEST * (10n ** 18n)) / ammYesOut; // USDC per YES, 18dp
    record("7a. AMM quote", true, `${formatUnits(INVEST, 6)} USDC → ${formatUnits(ammYesOut, 6)} YES @ ${formatUnits(ammPriceWad, 18)}`);

    // ── Quote the CLOB: best ask price for YES ────────────────────────────────
    const book = await getJson(`/book?tokenId=${yes.toString()}`);
    const bestAsk = book.json?.data?.asks?.[0];
    const clobPriceWad = bestAsk ? BigInt(bestAsk.priceWad) : maxUint256;
    record("7b. CLOB quote", true, bestAsk ? `best ask @ ${formatUnits(clobPriceWad, 18)} (size ${formatUnits(BigInt(bestAsk.remainingMaker), 6)} YES)` : "empty book");

    // ── Route: pick the cheaper venue ─────────────────────────────────────────
    const routeAmm = ammPriceWad <= clobPriceWad;
    record("7c. router decision", true, routeAmm ? `AMM cheaper (${formatUnits(ammPriceWad, 18)} ≤ ${formatUnits(clobPriceWad, 18)})` : `CLOB cheaper (${formatUnits(clobPriceWad, 18)} < ${formatUnits(ammPriceWad, 18)})`);

    const takerYesBefore = await readCt("balanceOf", [TAKER.address, yes]);
    const takerUsdcBefore = await readUsdc("balanceOf", [TAKER.address]);

    if (routeAmm) {
        // Execute on the AMM.
        await txWait(publicClient, takerWc, {
            address: poolAddr, abi: pool.abi, functionName: "buy",
            args: [INVEST, BigInt(OUTCOME_YES), ammYesOut],
        });
        const takerYesAfter = await readCt("balanceOf", [TAKER.address, yes]);
        const takerUsdcAfter = await readUsdc("balanceOf", [TAKER.address]);
        const gained = takerYesAfter - takerYesBefore;
        const spent = takerUsdcBefore - takerUsdcAfter;
        assert(gained === ammYesOut, "7d. router executed AMM buy — YES received on-chain", `+${formatUnits(gained, 6)} YES`);
        assert(spent === INVEST, "7e. router AMM buy — USDC left taker on-chain", `-${formatUnits(spent, 6)} USDC`);
        record("7. ROUTER SELF-CHECK PASSED (executed AMM, on-chain fill verified)", true, "");
    } else {
        // Execute on the CLOB: sign a marketable taker BUY that crosses the best
        // ask, POST it, and let the relay settle via matchOrders on-chain.
        const bestAskPrice = Number(formatUnits(clobPriceWad, 18));
        const wantShares = Number(formatUnits(BigInt(bestAsk.remainingMaker), 6)); // take the full level
        const sharesRaw = USDC(wantShares);
        const usdcRaw = USDC(Math.ceil(wantShares * bestAskPrice * 1e6) / 1e6);
        const takerBuilder = new ExchangeOrderBuilder(exchangeAddr, CHAIN_ID, wc(TAKER));
        const buy = await takerBuilder.buildSignedOrder({
            maker: TAKER.address, signer: TAKER.address, taker: zeroAddress,
            tokenId: yes.toString(), makerAmount: usdcRaw.toString(), takerAmount: sharesRaw.toString(),
            side: OrderSide.BUY, feeRateBps: "0", nonce: "0", signatureType: SignatureType.EOA, expiration: "0",
        });
        const buyRes = await post("/orders", buy);
        assert(buyRes.status === 201, "7d. router posted marketable CLOB BUY", `http=${buyRes.status} ${JSON.stringify(buyRes.json?.error ?? "")}`);
        assert(buyRes.json?.data?.matched === true, "7e. relay matched taker on-chain via matchOrders", `txHash=${buyRes.json?.data?.txHash}`);
        const takerYesAfter = await readCt("balanceOf", [TAKER.address, yes]);
        const gained = takerYesAfter - takerYesBefore;
        assert(gained > 0n, "7f. router executed CLOB buy — YES received on-chain", `+${formatUnits(gained, 6)} YES`);
        record("7. ROUTER SELF-CHECK PASSED (executed CLOB, on-chain fill verified)", true, `settle tx=${buyRes.json?.data?.txHash}`);
    }
}

// ── Env block printer ─────────────────────────────────────────────────────────
function printEnvBlock(a) {
    console.log("\n╔══════════════════════════════════════════════════════════════╗");
    console.log("║  PASTE INTO oracle/web/.env.local  (points the web app here)   ║");
    console.log("╚══════════════════════════════════════════════════════════════╝");
    const lines = [
        `# Predikt local full-stack demo — anvil chainId ${CHAIN_ID}`,
        `NEXT_PUBLIC_ONCHAIN_CHAIN_ID=${CHAIN_ID}`,
        `NEXT_PUBLIC_ONCHAIN_RPC_URL=${RPC_URL}`,
        `NEXT_PUBLIC_ONCHAIN_USDC_ADDRESS=${a.usdc}`,
        `NEXT_PUBLIC_ONCHAIN_CTF_ADDRESS=${a.ct}`,
        `NEXT_PUBLIC_ONCHAIN_EXCHANGE_ADDRESS=${a.exchange}`,
        `NEXT_PUBLIC_ONCHAIN_FPMM_FACTORY_ADDRESS=${a.factory}`,
        `NEXT_PUBLIC_ONCHAIN_UMA_ADAPTER_ADDRESS=${a.adapter}`,
        `NEXT_PUBLIC_ONCHAIN_CONDITION_ID=${a.conditionId}`,
        `NEXT_PUBLIC_ONCHAIN_YES_TOKEN_ID=${a.yes.toString()}`,
        `NEXT_PUBLIC_ONCHAIN_NO_TOKEN_ID=${a.no.toString()}`,
        `NEXT_PUBLIC_ONCHAIN_FPMM_POOL_ADDRESS=${a.poolAddr}`,
        `NEXT_PUBLIC_RELAY_URL=${RELAY_URL}`,
        `RELAY_URL=${RELAY_URL}`,
    ];
    console.log(lines.join("\n"));
    console.log("");
}

// ── bytes helpers ─────────────────────────────────────────────────────────────
function nameToBytes32(name) {
    // UMA Finder keys interface names as bytes32 (right-padded ascii).
    const hex = Buffer.from(name, "utf8").toString("hex");
    return `0x${hex.padEnd(64, "0")}`;
}
function toHexBytes(str) {
    return `0x${Buffer.from(str, "utf8").toString("hex")}`;
}

// ── Signals + entrypoint ──────────────────────────────────────────────────────
process.on("SIGINT", () => {
    console.log("\n[demo] SIGINT — tearing down anvil + relay…");
    teardown();
    process.exit(0);
});
process.on("SIGTERM", () => {
    teardown();
    process.exit(0);
});

main()
    .catch((err) => {
        console.error("\n[DEMO ERROR]", err?.shortMessage ?? err?.message ?? err);
        if (err?.stack) console.error(err.stack);
        console.log("\n=== PARTIAL SUMMARY (stopped at first failure) ===");
        for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.step}`);
        process.exitCode = 1;
        teardown();
    })
    .finally(() => {
        // In self-check/CI mode (or on error) we tear down here. In interactive
        // mode main() never resolves (it blocks on SIGINT), so this only runs
        // after the self-check-only path or a failure.
        if (SELFCHECK_ONLY || process.exitCode) {
            teardown();
        }
    });
