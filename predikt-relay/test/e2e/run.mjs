// ─────────────────────────────────────────────────────────────────────────
// Predikt on-chain order-flow E2E — REAL anvil, REAL deploys, REAL signed
// orders, REAL on-chain balance assertions.
//
// Flow:
//   1. Start anvil (known default mnemonic) in the background.
//   2. Deploy the REAL contracts: USDC mock (6dp) + ConditionalTokens +
//      CTFExchange(collateral, ctf, 0, 0)  — reusing the ctf-exchange repo's
//      own compiled artifacts (out/ + artifacts/).
//   3. prepareCondition + registerToken(yes,no,conditionId); grant the relay
//      operator the exchange operator role.
//   4. Fund maker (USDC -> splitPosition -> YES+NO) and taker (USDC), set
//      approvals.
//   5. Boot the REAL relay (src/server.ts) pointed at anvil + deployed addrs.
//   6. Maker signs a real EIP-712 SELL of YES via @predikt/orders and POSTs it;
//      taker signs a marketable BUY of YES and POSTs it. Relay calls
//      matchOrders on-chain.
//   7. Assert on-chain: taker received YES, maker received USDC.
//   8. Resolve the condition (reportPayouts) + redeemPositions; assert winner
//      gets USDC.
//   9. Tear down anvil + relay.
//
// Every step prints PASS/FAIL with the real asserted values. Any failure is
// reported honestly with the underlying error; the harness never fakes success.
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
    encodeFunctionData,
    parseUnits,
    formatUnits,
    getContract,
    maxUint256,
    zeroAddress,
    zeroHash,
} from "viem";
import { privateKeyToAccount, mnemonicToAccount } from "viem/accounts";
import { loadArtifacts } from "./artifacts.mjs";
import { ExchangeOrderBuilder, OrderSide, SignatureType } from "@predikt/orders";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RELAY_DIR = resolve(__dirname, "../..");

// ── Config ────────────────────────────────────────────────────────────────
const ANVIL_MNEMONIC =
    "test test test test test test test test test test test junk"; // anvil default
const RPC_PORT = 8546; // avoid clashing with a stray 8545
const RPC_URL = `http://127.0.0.1:${RPC_PORT}`;
const CHAIN_ID = 31337;
const RELAY_PORT = 8799;
const RELAY_URL = `http://127.0.0.1:${RELAY_PORT}`;
const QUESTION_ID =
    "0x1234000000000000000000000000000000000000000000000000000000000000";

// Anvil funded accounts (default mnemonic). We derive their private keys below.
const KEYS = derivePrivateKeys(ANVIL_MNEMONIC, 4);
const DEPLOYER = KEYS[0]; // exchange admin + deploys everything
const OPERATOR = KEYS[1]; // relay operator (matchOrders msg.sender)
const MAKER = KEYS[2]; // signs the resting SELL order
const TAKER = KEYS[3]; // signs the marketable BUY order

// ── Result tracking ─────────────────────────────────────────────────────────
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

// ── Helpers ─────────────────────────────────────────────────────────────────
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

let anvilProc = null;
let relayProc = null;
let tmpDataDir = null;

function startAnvil() {
    return new Promise((resolveP, rejectP) => {
        anvilProc = spawn(
            "anvil",
            [
                "--port",
                String(RPC_PORT),
                "--mnemonic",
                ANVIL_MNEMONIC,
                "--chain-id",
                String(CHAIN_ID),
                "--silent",
            ],
            { stdio: ["ignore", "pipe", "pipe"] },
        );
        anvilProc.on("error", rejectP);
        // Give anvil a moment; we poll the RPC below to confirm readiness.
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

async function waitForRelay(tries = 60) {
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
    tmpDataDir = mkdtempSync(resolve(tmpdir(), "predikt-e2e-"));
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
    // Prefer the compiled entrypoint (`dist/server.js`, i.e. `npm start`): it is
    // plain JS and runs on any supported Node. Fall back to the TS source via
    // type-stripping only when dist is absent (needs a Node new enough to strip
    // TS *with* parameter properties, which not all versions support).
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
    const hash = await walletClient.deployContract({
        abi: artifact.abi,
        bytecode: artifact.bytecode,
        args,
    });
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

// ── Main ─────────────────────────────────────────────────────────────────
async function main() {
    console.log("=== Predikt on-chain order-flow E2E ===");
    console.log(`deployer=${DEPLOYER.address}`);
    console.log(`operator=${OPERATOR.address} (relay)`);
    console.log(`maker   =${MAKER.address}`);
    console.log(`taker   =${TAKER.address}`);

    const artifacts = loadArtifacts();

    // 1) anvil
    await startAnvil();
    const publicClient = createPublicClient({ transport: http(RPC_URL) });
    await waitForRpc(publicClient);
    const bn = await publicClient.getBlockNumber();
    record("1. anvil started", true, `chainId=${CHAIN_ID} block=${bn} rpc=${RPC_URL}`);

    const wc = (key) =>
        createWalletClient({
            account: privateKeyToAccount(key.pk),
            chain: { id: CHAIN_ID, name: "anvil", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC_URL] } } },
            transport: http(RPC_URL),
        });

    const deployerWc = wc(DEPLOYER);

    // 2) deploy contracts
    const usdcAddr = await deploy(deployerWc, publicClient, artifacts.usdc, [], "USDC");
    const ctAddr = await deploy(deployerWc, publicClient, artifacts.conditionalTokens, [], "ConditionalTokens");
    const exchangeAddr = await deploy(
        deployerWc,
        publicClient,
        artifacts.exchange,
        [usdcAddr, ctAddr, zeroAddress, zeroAddress],
        "CTFExchange",
    );
    record("2. contracts deployed", true, `USDC=${usdcAddr} CTF=${ctAddr} Exchange=${exchangeAddr}`);

    const exchange = { address: exchangeAddr, abi: artifacts.exchange.abi };
    const usdc = { address: usdcAddr, abi: artifacts.usdc.abi };
    const ct = { address: ctAddr, abi: artifacts.conditionalTokens.abi };

    const readCt = (fn, args) => publicClient.readContract({ address: ctAddr, abi: ct.abi, functionName: fn, args });
    const readEx = (fn, args) => publicClient.readContract({ address: exchangeAddr, abi: exchange.abi, functionName: fn, args });
    const readUsdc = (fn, args) => publicClient.readContract({ address: usdcAddr, abi: usdc.abi, functionName: fn, args });

    // 3) prepareCondition + register outcome pair + grant operator role
    // Oracle for the condition = deployer (so the test can resolve later).
    await txWait(publicClient, deployerWc, {
        address: ctAddr, abi: ct.abi, functionName: "prepareCondition",
        args: [DEPLOYER.address, QUESTION_ID, 2n],
    });
    const conditionId = await readCt("getConditionId", [DEPLOYER.address, QUESTION_ID, 2n]);

    // positionId(indexSet) = getPositionId(usdc, getCollectionId(0, conditionId, indexSet))
    const collectionYes = await readCt("getCollectionId", [zeroHash, conditionId, 2n]); // indexSet 2 = YES
    const collectionNo = await readCt("getCollectionId", [zeroHash, conditionId, 1n]); // indexSet 1 = NO
    const yes = await readCt("getPositionId", [usdcAddr, collectionYes]);
    const no = await readCt("getPositionId", [usdcAddr, collectionNo]);

    await txWait(publicClient, deployerWc, {
        address: exchangeAddr, abi: exchange.abi, functionName: "registerToken",
        args: [yes, no, conditionId],
    });
    // Grant the relay operator the exchange operator role (deployer is admin).
    await txWait(publicClient, deployerWc, {
        address: exchangeAddr, abi: exchange.abi, functionName: "addOperator",
        args: [OPERATOR.address],
    });

    const complement = await readEx("getComplement", [yes]);
    const isOp = await readEx("isOperator", [OPERATOR.address]);
    assert(complement === no, "3a. YES registered (complement == NO)", `complement=${complement}`);
    assert(isOp === true, "3b. relay operator granted operator role", `operator=${OPERATOR.address}`);
    record("3. condition prepared + token pair registered", true, `conditionId=${conditionId}\n     YES=${yes}\n     NO =${no}`);

    // 4) fund maker + taker
    const USDC = (n) => parseUnits(String(n), 6); // 6dp collateral
    const makerWc = wc(MAKER);
    const takerWc = wc(TAKER);

    // Maker: mint USDC, approve CTF, split into YES+NO, approve exchange for ERC1155.
    await txWait(publicClient, deployerWc, { address: usdcAddr, abi: usdc.abi, functionName: "mint", args: [MAKER.address, USDC(1000)] });
    await txWait(publicClient, makerWc, { address: usdcAddr, abi: usdc.abi, functionName: "approve", args: [ctAddr, maxUint256] });
    // splitPosition(collateral, parentCollectionId=0, conditionId, partition[1,2], amount)
    // Mints `amount` of BOTH YES and NO to the maker, burning `amount` USDC.
    await txWait(publicClient, makerWc, {
        address: ctAddr, abi: ct.abi, functionName: "splitPosition",
        args: [usdcAddr, zeroHash, conditionId, [1n, 2n], USDC(500)],
    });
    await txWait(publicClient, makerWc, { address: ctAddr, abi: ct.abi, functionName: "setApprovalForAll", args: [exchangeAddr, true] });
    // Maker also approves exchange to pull USDC (harmless; not needed for a SELL).
    await txWait(publicClient, makerWc, { address: usdcAddr, abi: usdc.abi, functionName: "approve", args: [exchangeAddr, maxUint256] });

    // Taker: mint USDC, approve exchange (BUY pulls USDC), approve CTF (receives ERC1155).
    await txWait(publicClient, deployerWc, { address: usdcAddr, abi: usdc.abi, functionName: "mint", args: [TAKER.address, USDC(1000)] });
    await txWait(publicClient, takerWc, { address: usdcAddr, abi: usdc.abi, functionName: "approve", args: [exchangeAddr, maxUint256] });
    await txWait(publicClient, takerWc, { address: ctAddr, abi: ct.abi, functionName: "setApprovalForAll", args: [exchangeAddr, true] });

    const makerYes = await readCt("balanceOf", [MAKER.address, yes]);
    const makerNo = await readCt("balanceOf", [MAKER.address, no]);
    const takerUsdc = await readUsdc("balanceOf", [TAKER.address]);
    assert(makerYes === USDC(500), "4a. maker holds 500 YES after split", `YES=${formatUnits(makerYes, 6)}`);
    assert(makerNo === USDC(500), "4b. maker holds 500 NO after split", `NO=${formatUnits(makerNo, 6)}`);
    assert(takerUsdc >= USDC(1000), "4c. taker funded with USDC", `USDC=${formatUnits(takerUsdc, 6)}`);
    record("4. maker + taker funded/approved", true, "");

    // 5) start the relay
    startRelay({ exchange: exchangeAddr, usdc: usdcAddr, ct: ctAddr });
    const health = await waitForRelay();
    assert(
        health?.data?.operator?.toLowerCase() === OPERATOR.address.toLowerCase(),
        "5. relay up and using operator key",
        `operator=${health?.data?.operator} block=${health?.data?.blockNumber}`,
    );

    // 6) sign + POST maker SELL, then taker BUY
    // Real EIP-712 signing via @predikt/orders ExchangeOrderBuilder against the
    // deployed exchange address + chainId (the same domain the relay verifies).
    // The SDK's ClobSigner accepts a viem WalletClient (signTypedData), so we
    // sign with the maker/taker local accounts — no ethers dependency needed.
    const makerBuilder = new ExchangeOrderBuilder(exchangeAddr, CHAIN_ID, wc(MAKER));
    const takerBuilder = new ExchangeOrderBuilder(exchangeAddr, CHAIN_ID, wc(TAKER));

    // Price 0.50 USDC/share, size 100 YES.
    // Maker SELL YES: makerAmount = 100 YES (6dp), takerAmount = 50 USDC (6dp).
    const SHARES = 100;
    const PRICE = 0.5;
    const sharesRaw = USDC(SHARES); // outcome tokens share the collateral's 6dp here
    const usdcRaw = USDC(SHARES * PRICE);

    const sellOrder = await makerBuilder.buildSignedOrder({
        maker: MAKER.address,
        signer: MAKER.address,
        taker: zeroAddress,
        tokenId: yes.toString(),
        makerAmount: sharesRaw.toString(), // sells 100 YES
        takerAmount: usdcRaw.toString(), // wants 50 USDC
        side: OrderSide.SELL,
        feeRateBps: "0",
        nonce: "0",
        signatureType: SignatureType.EOA,
        expiration: "0",
    });

    // Taker BUY YES: makerAmount = 50 USDC, takerAmount = 100 YES (marketable, crosses at 0.50).
    const buyOrder = await takerBuilder.buildSignedOrder({
        maker: TAKER.address,
        signer: TAKER.address,
        taker: zeroAddress,
        tokenId: yes.toString(),
        makerAmount: usdcRaw.toString(), // pays 50 USDC
        takerAmount: sharesRaw.toString(), // wants 100 YES
        side: OrderSide.BUY,
        feeRateBps: "0",
        nonce: "0",
        signatureType: SignatureType.EOA,
        expiration: "0",
    });

    const sellRes = await post("/orders", sellOrder);
    assert(sellRes.status === 201, "6a. maker SELL accepted by relay", `http=${sellRes.status} ${JSON.stringify(sellRes.json?.error ?? "")}`);

    // Snapshot balances right before the crossing taker order.
    const takerYesBefore = await readCt("balanceOf", [TAKER.address, yes]);
    const makerUsdcBefore = await readUsdc("balanceOf", [MAKER.address]);
    const takerUsdcBefore = await readUsdc("balanceOf", [TAKER.address]);

    const buyRes = await post("/orders", buyOrder);
    assert(buyRes.status === 201, "6b. taker BUY accepted by relay", `http=${buyRes.status} ${JSON.stringify(buyRes.json?.error ?? "")}`);
    assert(buyRes.json?.data?.matched === true, "6c. relay matched taker on-chain", `txHash=${buyRes.json?.data?.txHash}`);

    // 7) assert on-chain fill
    const takerYesAfter = await readCt("balanceOf", [TAKER.address, yes]);
    const makerUsdcAfter = await readUsdc("balanceOf", [MAKER.address]);
    const takerUsdcAfter = await readUsdc("balanceOf", [TAKER.address]);

    const yesGained = takerYesAfter - takerYesBefore;
    const makerUsdcGained = makerUsdcAfter - makerUsdcBefore;
    const takerUsdcSpent = takerUsdcBefore - takerUsdcAfter;

    assert(yesGained === sharesRaw, "7a. taker received 100 YES on-chain", `+${formatUnits(yesGained, 6)} YES`);
    assert(makerUsdcGained === usdcRaw, "7b. maker received 50 USDC on-chain", `+${formatUnits(makerUsdcGained, 6)} USDC`);
    assert(takerUsdcSpent === usdcRaw, "7c. taker paid 50 USDC on-chain", `-${formatUnits(takerUsdcSpent, 6)} USDC`);
    record("7. on-chain fill verified via matchOrders", true, `settle tx=${buyRes.json?.data?.txHash}`);

    // 8) resolve + redeem — YES wins (payout [NO=0, YES=1]).
    // reportPayouts(questionId, payouts[]) where payout index maps to index-set
    // bit: payouts[0] -> outcome slot 0 (indexSet 1 = NO), payouts[1] -> slot 1
    // (indexSet 2 = YES). So [0,1] => YES wins.
    await txWait(publicClient, deployerWc, {
        address: ctAddr, abi: ct.abi, functionName: "reportPayouts",
        args: [QUESTION_ID, [0n, 1n]],
    });
    const denom = await readCt("payoutDenominator", [conditionId]);
    assert(denom > 0n, "8a. condition resolved (reportPayouts)", `payoutDenominator=${denom}`);

    // Taker redeems its YES position -> USDC. redeemPositions(collateral,
    // parentCollectionId=0, conditionId, indexSets[]). Redeem the YES slot (indexSet 2).
    const takerUsdcPreRedeem = await readUsdc("balanceOf", [TAKER.address]);
    await txWait(publicClient, takerWc, {
        address: ctAddr, abi: ct.abi, functionName: "redeemPositions",
        args: [usdcAddr, zeroHash, conditionId, [2n]],
    });
    const takerYesPostRedeem = await readCt("balanceOf", [TAKER.address, yes]);
    const takerUsdcPostRedeem = await readUsdc("balanceOf", [TAKER.address]);
    const redeemed = takerUsdcPostRedeem - takerUsdcPreRedeem;

    assert(takerYesPostRedeem === 0n, "8b. taker YES burned on redeem", `YES=${takerYesPostRedeem}`);
    assert(redeemed === sharesRaw, "8c. winner redeemed 100 USDC (YES paid 1:1)", `+${formatUnits(redeemed, 6)} USDC`);
    record("8. resolution + redemption verified on-chain", true, "");

    console.log("\n=== SUMMARY ===");
    for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.step}`);
    const failed = results.filter((r) => !r.pass);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
    if (failed.length) process.exitCode = 1;
}

main()
    .catch((err) => {
        console.error("\n[E2E ERROR]", err?.message ?? err);
        if (err?.stack) console.error(err.stack);
        // Still print whatever passed before the failure.
        console.log("\n=== PARTIAL SUMMARY (stopped at first failure) ===");
        for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.step}`);
        process.exitCode = 1;
    })
    .finally(() => {
        record("9. teardown (anvil + relay killed)", true, "");
        teardown();
    });
