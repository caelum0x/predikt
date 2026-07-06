// ─────────────────────────────────────────────────────────────────────────
// Predikt FPMM (Fixed Product Market Maker) on-chain E2E — REAL anvil, REAL
// deploys, REAL AMM math, REAL on-chain balance assertions.
//
// This mirrors the relay's e2e (predikt-relay/test/e2e/run.mjs) but exercises
// the *instant-liquidity* AMM path instead of the order book. The AMM sources
// are Predikt's own fpmm/ contracts (Gnosis-derived, pricing logic UNCHANGED),
// compiled by forge with solc 0.5.x.
//
// Flow:
//   1. Start anvil (anvil default mnemonic) in the background.
//   2. Deploy the REAL contracts:
//        - USDC mock (6dp)                 (ctf-exchange/out)
//        - ConditionalTokens               (ctf-exchange/artifacts)
//        - FPMMDeterministicFactory        (fpmm/out — Predikt's own)
//   3. prepareCondition(oracle, questionId, 2 outcomes) on ConditionalTokens.
//   4. Market creator seeds a pool: approve USDC to the factory, then
//      create2FixedProductMarketMaker(... initialFunds, distributionHint) which
//      creates the FPMM clone AND calls addFunding in one tx. We recover the
//      pool address from the FixedProductMarketMakerCreation event.
//        - fee = 2% (2e16, i.e. 0.02 * 1e18).
//        - distributionHint [1,1] => 50/50 YES/NO starting odds.
//   5. Assert the pool holds equal YES+NO liquidity and the creator got LP shares.
//   6. A taker BUYS YES: calcBuyAmount(investment, YES) -> buy(...) with slippage
//      guard. Assert taker received >= quoted YES and USDC left their wallet.
//   7. The taker SELLS those YES back: calcSellAmount(...) is implied by sell();
//      we drive it via a target returnAmount + maxOutcomeTokensToSell guard.
//      Assert taker's YES balance dropped and USDC came back.
//   8. Tear down anvil.
//
// Every step prints PASS/FAIL with the real asserted values. Any failure is
// reported honestly with the underlying error; the harness never fakes success.
// ─────────────────────────────────────────────────────────────────────────

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
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
    zeroAddress,
    zeroHash,
} from "viem";
import { privateKeyToAccount, mnemonicToAccount } from "viem/accounts";
import { loadArtifacts } from "./artifacts.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────────────────────
const ANVIL_MNEMONIC =
    "test test test test test test test test test test test junk"; // anvil default
const RPC_PORT = Number(process.env.RPC_PORT || 8547); // avoid clashing with relay e2e (8546)
const RPC_URL = `http://127.0.0.1:${RPC_PORT}`;
const CHAIN_ID = 31337;
const QUESTION_ID =
    "0x1234000000000000000000000000000000000000000000000000000000000000";

// FPMM fee: 2% expressed as an 18-dp fraction (the FPMM uses ONE = 1e18).
const FEE = parseUnits("0.02", 18); // 2e16

// Anvil funded accounts (default mnemonic).
const KEYS = derivePrivateKeys(ANVIL_MNEMONIC, 3);
const DEPLOYER = KEYS[0]; // deploys everything + is the condition oracle
const CREATOR = KEYS[1]; // market creator: seeds the pool with addFunding
const TAKER = KEYS[2]; // trader: buys then sells YES via the AMM

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

function teardown() {
    if (anvilProc && !anvilProc.killed) anvilProc.kill("SIGKILL");
}

async function deploy(walletClient, publicClient, artifact, args, label) {
    const hash = await walletClient.deployContract({
        abi: artifact.abi,
        bytecode: artifact.bytecode,
        args,
    });
    const rcpt = await publicClient.waitForTransactionReceipt({ hash });
    if (!rcpt.contractAddress)
        throw new Error(`${label} deploy produced no address`);
    return rcpt.contractAddress;
}

async function txWait(publicClient, walletClient, params) {
    const hash = await walletClient.writeContract(params);
    const rcpt = await publicClient.waitForTransactionReceipt({ hash });
    if (rcpt.status !== "success")
        throw new Error(`tx reverted: ${JSON.stringify(params.functionName)}`);
    return rcpt;
}

// ── Main ─────────────────────────────────────────────────────────────────
async function main() {
    console.log("=== Predikt FPMM (instant-liquidity AMM) on-chain E2E ===");
    console.log(`deployer=${DEPLOYER.address} (oracle)`);
    console.log(`creator =${CREATOR.address} (seeds pool)`);
    console.log(`taker   =${TAKER.address} (buys/sells YES)`);

    const artifacts = loadArtifacts();

    // 1) anvil
    await startAnvil();
    const publicClient = createPublicClient({ transport: http(RPC_URL) });
    await waitForRpc(publicClient);
    const bn = await publicClient.getBlockNumber();
    record("1. anvil started", true, `chainId=${CHAIN_ID} block=${bn} rpc=${RPC_URL}`);

    const chain = {
        id: CHAIN_ID,
        name: "anvil",
        nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: [RPC_URL] } },
    };
    const wc = (key) =>
        createWalletClient({
            account: privateKeyToAccount(key.pk),
            chain,
            transport: http(RPC_URL),
        });

    const deployerWc = wc(DEPLOYER);
    const creatorWc = wc(CREATOR);
    const takerWc = wc(TAKER);

    // 2) deploy contracts
    const usdcAddr = await deploy(deployerWc, publicClient, artifacts.usdc, [], "USDC");
    const ctAddr = await deploy(
        deployerWc,
        publicClient,
        artifacts.conditionalTokens,
        [],
        "ConditionalTokens",
    );
    const factoryAddr = await deploy(
        deployerWc,
        publicClient,
        artifacts.factory,
        [],
        "FPMMDeterministicFactory",
    );
    record(
        "2. contracts deployed",
        true,
        `USDC=${usdcAddr}\n     CTF=${ctAddr}\n     FPMMFactory=${factoryAddr}`,
    );

    const ct = { address: ctAddr, abi: artifacts.conditionalTokens.abi };
    const usdc = { address: usdcAddr, abi: artifacts.usdc.abi };

    const readCt = (fn, args) =>
        publicClient.readContract({ address: ctAddr, abi: ct.abi, functionName: fn, args });
    const readUsdc = (fn, args) =>
        publicClient.readContract({ address: usdcAddr, abi: usdc.abi, functionName: fn, args });

    // confirm USDC is 6dp (the mock is; assert it so amounts are meaningful)
    const usdcDecimals = await readUsdc("decimals", []);
    assert(Number(usdcDecimals) === 6, "2a. collateral USDC is 6dp", `decimals=${usdcDecimals}`);
    const USDC = (n) => parseUnits(String(n), 6);

    // 3) prepareCondition (2 outcomes). Outcome-index convention MUST match
    // production (oracle/web/lib/onchain/market.ts + amm.ts): the FPMM builds
    // positionIds from indexSet (1 << i), and production fixes
    //   outcomeIndex 0 == indexSet 1 == YES,  outcomeIndex 1 == indexSet 2 == NO
    // (market.ts YES_INDEX_SET=1/NO_INDEX_SET=2, derivePositionIds returns
    //  [YES(1), NO(2)], OUTCOME={YES:0,NO:1}). We derive + label the SAME way so
    // this e2e proves the exact index production routes through.
    await txWait(publicClient, deployerWc, {
        address: ctAddr,
        abi: ct.abi,
        functionName: "prepareCondition",
        args: [DEPLOYER.address, QUESTION_ID, 2n],
    });
    const conditionId = await readCt("getConditionId", [DEPLOYER.address, QUESTION_ID, 2n]);

    // Position ids as the FPMM builds them internally: outcomeIndex i -> indexSet
    // (1 << i). Matching production: index0 = YES (indexSet 1), index1 = NO (2).
    const collectionYes = await readCt("getCollectionId", [zeroHash, conditionId, 1n]);
    const collectionNo = await readCt("getCollectionId", [zeroHash, conditionId, 2n]);
    const posYes = await readCt("getPositionId", [usdcAddr, collectionYes]); // FPMM outcomeIndex 0
    const posNo = await readCt("getPositionId", [usdcAddr, collectionNo]); // FPMM outcomeIndex 1
    const OUTCOME_YES = 0;
    const OUTCOME_NO = 1;
    record(
        "3. condition prepared",
        true,
        `conditionId=${conditionId}\n     posYES(idx0)=${posYes}\n     posNO (idx1)=${posNo}`,
    );

    // 4) market creator seeds the pool via the factory (create + addFunding in one tx)
    const SEED = USDC(1000); // 1,000 USDC of instant liquidity
    await txWait(publicClient, deployerWc, {
        address: usdcAddr, abi: usdc.abi, functionName: "mint", args: [CREATOR.address, SEED],
    });
    await txWait(publicClient, creatorWc, {
        address: usdcAddr, abi: usdc.abi, functionName: "approve", args: [factoryAddr, maxUint256],
    });

    const createRcpt = await txWait(publicClient, creatorWc, {
        address: factoryAddr,
        abi: artifacts.factory.abi,
        functionName: "create2FixedProductMarketMaker",
        // (saltNonce, conditionalTokens, collateral, conditionIds[], fee, initialFunds, distributionHint[])
        args: [
            1n,
            ctAddr,
            usdcAddr,
            [conditionId],
            FEE,
            SEED,
            [1n, 1n], // 50/50 starting distribution => equal YES/NO odds
        ],
    });

    // Recover the pool address from the FixedProductMarketMakerCreation event.
    const creationLogs = parseEventLogs({
        abi: artifacts.factory.abi,
        eventName: "FixedProductMarketMakerCreation",
        logs: createRcpt.logs,
    });
    assert(
        creationLogs.length === 1,
        "4a. pool created via FPMMDeterministicFactory",
        `events=${creationLogs.length}`,
    );
    const poolAddr = creationLogs[0].args.fixedProductMarketMaker;
    const pool = { address: poolAddr, abi: artifacts.fpmm.abi };
    const readPool = (fn, args) =>
        publicClient.readContract({ address: poolAddr, abi: pool.abi, functionName: fn, args });

    // The pool now holds YES+NO liquidity; the creator holds LP shares.
    const poolYes = await readCt("balanceOf", [poolAddr, posYes]);
    const poolNo = await readCt("balanceOf", [poolAddr, posNo]);
    const creatorLp = await readPool("balanceOf", [CREATOR.address]);
    const poolFee = await readPool("fee", []);
    assert(
        poolYes === SEED && poolNo === SEED,
        "4b. pool seeded with equal YES/NO liquidity",
        `YES=${formatUnits(poolYes, 6)} NO=${formatUnits(poolNo, 6)}`,
    );
    assert(creatorLp > 0n, "4c. creator received LP shares", `LP=${formatUnits(creatorLp, 6)}`);
    assert(poolFee === FEE, "4d. pool fee = 2%", `fee=${formatUnits(poolFee, 16)}%`);
    record("4. market creator seeded pool via addFunding", true, `pool=${poolAddr}`);

    // 5) taker BUYS YES through the AMM.
    const INVEST = USDC(100); // taker invests 100 USDC into YES
    await txWait(publicClient, deployerWc, {
        address: usdcAddr, abi: usdc.abi, functionName: "mint", args: [TAKER.address, INVEST],
    });
    await txWait(publicClient, takerWc, {
        address: usdcAddr, abi: usdc.abi, functionName: "approve", args: [poolAddr, maxUint256],
    });

    // Quote first (real on-chain view call), then buy with that quote as the min.
    const quotedYes = await readPool("calcBuyAmount", [INVEST, BigInt(OUTCOME_YES)]);
    assert(quotedYes > 0n, "5a. calcBuyAmount(100 USDC, YES) quoted", `~${formatUnits(quotedYes, 6)} YES`);

    const takerUsdcBeforeBuy = await readUsdc("balanceOf", [TAKER.address]);
    const takerYesBeforeBuy = await readCt("balanceOf", [TAKER.address, posYes]);

    await txWait(publicClient, takerWc, {
        address: poolAddr,
        abi: pool.abi,
        functionName: "buy",
        args: [INVEST, BigInt(OUTCOME_YES), quotedYes], // minOutcomeTokensToBuy == quote (no slippage on a static chain)
    });

    const takerUsdcAfterBuy = await readUsdc("balanceOf", [TAKER.address]);
    const takerYesAfterBuy = await readCt("balanceOf", [TAKER.address, posYes]);
    const yesGained = takerYesAfterBuy - takerYesBeforeBuy;
    const usdcSpent = takerUsdcBeforeBuy - takerUsdcAfterBuy;

    assert(
        yesGained === quotedYes,
        "5b. taker received exactly the quoted YES tokens",
        `+${formatUnits(yesGained, 6)} YES (quote ${formatUnits(quotedYes, 6)})`,
    );
    assert(
        usdcSpent === INVEST,
        "5c. taker's 100 USDC left their wallet on buy",
        `-${formatUnits(usdcSpent, 6)} USDC`,
    );
    // AMM sanity check. In a 50/50 two-outcome pool YES trades near 0.50 USDC,
    // so ~98 USDC (100 minus the 2% fee) would buy ~196 YES at a *flat* price.
    // Price impact from the constant-product curve means the taker gets strictly
    // FEWER than that ideal (their own buying pushes YES up). Assert the curve
    // moved the price: 0 < yesGained < ideal-no-slippage amount.
    const feeFrac = FEE; // 2e16 out of 1e18
    const investAfterFee = INVEST - (INVEST * feeFrac) / parseUnits("1", 18); // ~98 USDC
    // ideal (flat 0.50 price) = investAfterFee / 0.5 = investAfterFee * 2
    const idealFlatPriceYes = investAfterFee * 2n;
    assert(
        yesGained > 0n && yesGained < idealFlatPriceYes,
        "5d. AMM curve applied (price impact => YES received < flat-price ideal)",
        `${formatUnits(yesGained, 6)} YES < ideal ${formatUnits(idealFlatPriceYes, 6)} YES`,
    );
    record("5. taker BUY via AMM verified on-chain", true, "");

    // 6) taker SELLS the YES back through the AMM.
    // sell(returnAmount, outcomeIndex, maxOutcomeTokensToSell): we ask for a
    // returnAmount of USDC and cap the YES we're willing to give up. Pick a
    // conservative returnAmount that the AMM can satisfy from what we hold, then
    // let the pool compute the exact YES to sell (bounded by maxOutcomeTokensToSell).
    await txWait(publicClient, takerWc, {
        address: ctAddr, abi: ct.abi, functionName: "setApprovalForAll", args: [poolAddr, true],
    });

    // Ask to get ~90% of the USDC we spent back out; the AMM decides the YES cost.
    const RETURN = (INVEST * 90n) / 100n; // 90 USDC target return
    const maxYesToSell = takerYesAfterBuy; // willing to spend up to all YES we hold

    const takerUsdcBeforeSell = await readUsdc("balanceOf", [TAKER.address]);
    const takerYesBeforeSell = await readCt("balanceOf", [TAKER.address, posYes]);

    await txWait(publicClient, takerWc, {
        address: poolAddr,
        abi: pool.abi,
        functionName: "sell",
        args: [RETURN, BigInt(OUTCOME_YES), maxYesToSell],
    });

    const takerUsdcAfterSell = await readUsdc("balanceOf", [TAKER.address]);
    const takerYesAfterSell = await readCt("balanceOf", [TAKER.address, posYes]);
    const usdcReturned = takerUsdcAfterSell - takerUsdcBeforeSell;
    const yesSold = takerYesBeforeSell - takerYesAfterSell;

    assert(
        usdcReturned === RETURN,
        "6a. taker received the requested USDC back on sell",
        `+${formatUnits(usdcReturned, 6)} USDC`,
    );
    assert(
        yesSold > 0n && yesSold <= maxYesToSell,
        "6b. taker's YES tokens were sold into the pool (within slippage cap)",
        `-${formatUnits(yesSold, 6)} YES (cap ${formatUnits(maxYesToSell, 6)})`,
    );
    record("6. taker SELL via AMM verified on-chain", true, "");

    // Net position summary (real reads).
    const takerYesFinal = await readCt("balanceOf", [TAKER.address, posYes]);
    const takerUsdcFinal = await readUsdc("balanceOf", [TAKER.address]);
    record(
        "7. final taker balances",
        true,
        `YES=${formatUnits(takerYesFinal, 6)}  USDC=${formatUnits(takerUsdcFinal, 6)}`,
    );

    console.log("\n=== SUMMARY ===");
    for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.step}`);
    const failed = results.filter((r) => !r.pass);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
    if (failed.length) process.exitCode = 1;
}

main()
    .catch((err) => {
        console.error("\n[E2E ERROR]", err?.shortMessage ?? err?.message ?? err);
        if (err?.stack) console.error(err.stack);
        console.log("\n=== PARTIAL SUMMARY (stopped at first failure) ===");
        for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.step}`);
        process.exitCode = 1;
    })
    .finally(() => {
        record("8. teardown (anvil killed)", true, "");
        teardown();
    });
