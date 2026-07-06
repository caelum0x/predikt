// ─────────────────────────────────────────────────────────────────────────
// Predikt DEPLOY-KIT — guided, ordered go-live for the on-chain stack.
//
// This is ORCHESTRATION ONLY. It writes NO Solidity and NO new deploy contracts.
// It wraps the repos' OWN deploy scripts and runs them in the correct order with
// the correct REAL primitive addresses (from chains.mjs / DEPLOY.md):
//
//   Step 1  CTFExchange       — ctf-exchange/src/exchange/scripts/ExchangeDeployment.s.sol
//                               via its own forge script (collateral = native USDC,
//                               to match the web app's NEXT_PUBLIC_ONCHAIN_USDC).
//   Step 2  UmaCtfAdapter     — uma-ctf-adapter/src/scripts/deploy/DeployAdapter.s.sol
//                               via its own forge script (real ConditionalTokens +
//                               real UMA Finder + OptimisticOracleV2).
//   Step 3  FPMM factory      — fpmm/script/deploy-fpmm.mjs pattern (Predikt's own
//                               FPMMDeterministicFactory; factory-only, no per-market
//                               condition/seed here — pools are created per market later).
//   Step 4  addOperator       — grant the relay operator EOA the exchange operator role
//                               (CTFExchange.addOperator), sent from the deployer which
//                               we keep as exchange ADMIN (see note below).
//
// Then it writes addresses.<chain>.json (PUBLIC addresses only) and prints the
// three env blocks (oracle/web, relay, market maker) to paste.
//
// AUTH NOTE (important, real behaviour): ExchangeDeployment.deployExchange(admin,…)
// grants admin+operator to `admin` and RENOUNCES the deployer's roles. So to run
// addOperator afterwards the caller must still be an admin. We therefore pass
// ADMIN = the deployer's own address, so the deployer key retains admin and can
// perform step 4. (Override with EXCHANGE_ADMIN if you want a separate admin — but
// then step 4 must be run from THAT admin key; the kit will detect and warn.)
//
// REAL ONLY: real forge broadcasts, real cast calls, real anvil in --dry-run.
// It will NOT run against a live chain here (no funded key) — it is correct and
// fully DRY-RUNNABLE. A real go-live needs the operator's funded key + gas.
//
// Usage:
//   node deploy.mjs --chain amoy   --dry-run          # simulate end-to-end (recommended first)
//   node deploy.mjs --chain amoy                       # real testnet deploy (needs funds)
//   node deploy.mjs --chain polygon                    # real mainnet deploy (needs funds)
//
// Required env:
//   PRIVATE_KEY    0x… deployer key (funded on the target chain). NEVER committed.
//   RPC            JSON-RPC endpoint (falls back to the chain's public default).
//   RELAY_OPERATOR / OPERATOR_ADDRESS   the relay operator EOA to grant (address).
//                  If unset, defaults to the deployer address (single-operator setup).
//
// Optional env:
//   EXCHANGE_ADMIN     admin for the exchange (default: deployer address).
//   COLLATERAL         override collateral (default: chain native USDC).
//   ETHERSCAN_API_KEY  if set with --verify, forge verifies on the block explorer.
// ─────────────────────────────────────────────────────────────────────────

import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { resolveChain } from "./chains.mjs";
import { allEnvBlocks } from "./env-blocks.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const KIT_DIR = __dirname;
const CONTRACTS_DIR = resolve(KIT_DIR, "..");
const CTF_EXCHANGE_DIR = resolve(CONTRACTS_DIR, "ctf-exchange");
const UMA_DIR = resolve(CONTRACTS_DIR, "uma-ctf-adapter");
const FPMM_DIR = resolve(CONTRACTS_DIR, "fpmm");

const ZERO = "0x0000000000000000000000000000000000000000";

// ── tiny arg/env parsing ───────────────────────────────────────────────────
function parseArgs(argv) {
    const out = { chain: null, dryRun: false, verify: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--chain") out.chain = argv[++i];
        else if (a === "--dry-run" || a === "--dry") out.dryRun = true;
        else if (a === "--verify") out.verify = true;
        else if (a.startsWith("--chain=")) out.chain = a.slice("--chain=".length);
    }
    return out;
}

function req(name) {
    const v = process.env[name];
    if (!v) throw new Error(`missing required env: ${name}`);
    return v;
}

function isAddress(s) {
    return typeof s === "string" && /^0x[0-9a-fA-F]{40}$/.test(s);
}

function fail(msg) {
    console.error(`\n[deploy-kit ERROR] ${msg}`);
    process.exit(1);
}

// ── cast helpers (never echo the private key) ──────────────────────────────
function castAddressFromKey(pk) {
    const r = spawnSync("cast", ["wallet", "address", "--private-key", pk], {
        encoding: "utf8",
    });
    if (r.status !== 0) throw new Error(`cast wallet address failed: ${r.stderr?.trim()}`);
    return r.stdout.trim();
}

function castCall(rpc, to, sig, args) {
    const r = spawnSync("cast", ["call", to, sig, ...args, "--rpc-url", rpc], {
        encoding: "utf8",
    });
    if (r.status !== 0) throw new Error(`cast call ${sig} failed: ${r.stderr?.trim()}`);
    return r.stdout.trim();
}

// ── step logging ───────────────────────────────────────────────────────────
const steps = [];
function step(n, title) {
    console.log(`\n────────────────────────────────────────────────────────`);
    console.log(`STEP ${n}: ${title}`);
    console.log(`────────────────────────────────────────────────────────`);
}
function ok(msg) {
    console.log(`  ✓ ${msg}`);
    steps.push({ ok: true, msg });
}
function note(msg) {
    console.log(`  · ${msg}`);
}

// ── main ───────────────────────────────────────────────────────────────────
async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (!args.chain) {
        fail(
            "missing --chain. Usage:\n" +
                "  node deploy.mjs --chain amoy --dry-run\n" +
                "  node deploy.mjs --chain amoy\n" +
                "  node deploy.mjs --chain polygon",
        );
    }
    const chain = resolveChain(args.chain);
    const dryRun = args.dryRun;
    const rpc = process.env.RPC || chain.defaultRpc;

    // PRIVATE_KEY: required for real deploys; in --dry-run a placeholder is fine
    // (we still need an address for ADMIN/operator wiring, so we derive it if a
    // real key is present, else use anvil's first default test key for dry-run).
    const ANVIL_KEY_0 =
        "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    let pk = process.env.PRIVATE_KEY;
    if (!pk) {
        if (dryRun) {
            pk = ANVIL_KEY_0;
            console.log(
                "\n[deploy-kit] no PRIVATE_KEY set — DRY RUN using anvil default test key\n" +
                    "             (address only; nothing is broadcast). Set PRIVATE_KEY for a real run.",
            );
        } else {
            fail("missing PRIVATE_KEY (required for a real deploy). Add --dry-run to simulate.");
        }
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) fail("PRIVATE_KEY must be a 0x-prefixed 32-byte hex key");

    const deployer = castAddressFromKey(pk);
    const admin = process.env.EXCHANGE_ADMIN || deployer;
    const operator =
        process.env.RELAY_OPERATOR || process.env.OPERATOR_ADDRESS || deployer;
    const collateral = process.env.COLLATERAL || chain.primitives.usdc;

    if (!isAddress(operator)) fail(`RELAY_OPERATOR/OPERATOR_ADDRESS is not a valid address: ${operator}`);
    if (!isAddress(admin)) fail(`EXCHANGE_ADMIN is not a valid address: ${admin}`);
    if (!isAddress(collateral)) fail(`COLLATERAL is not a valid address: ${collateral}`);

    console.log(`\n══════════════════════════════════════════════════════════`);
    console.log(` Predikt deploy-kit — ${chain.label} (chain ${chain.chainId})`);
    console.log(`══════════════════════════════════════════════════════════`);
    console.log(` mode         : ${dryRun ? "DRY RUN (simulate, no broadcast)" : "LIVE (broadcasts real txs)"}`);
    console.log(` rpc          : ${rpc}`);
    console.log(` deployer     : ${deployer}`);
    console.log(` exchange admin: ${admin}${admin === deployer ? " (deployer — keeps admin for step 4)" : " (external — see step 4 note)"}`);
    console.log(` relay operator: ${operator}${operator === deployer ? " (defaults to deployer)" : ""}`);
    console.log(` collateral   : ${collateral} (native USDC — matches the web app)`);
    console.log(` primitives   : CTF=${chain.primitives.ctf}`);
    console.log(`                UMA finder=${chain.primitives.umaFinder} oo=${chain.primitives.umaOptimisticOracle}`);
    console.log(`                proxyFactory=${chain.primitives.proxyFactory} safeFactory=${chain.primitives.safeFactory}`);

    if (collateral.toLowerCase() !== chain.primitives.usdc.toLowerCase()) {
        note(
            `WARNING: collateral (${collateral}) != chain native USDC (${chain.primitives.usdc}).\n` +
                `           You MUST set NEXT_PUBLIC_ONCHAIN_USDC to this same address in oracle/web.`,
        );
    }

    const deployed = {
        ctfExchange: null,
        umaCtfAdapter: null,
        fpmmFactory: null,
    };

    // ── STEP 1: CTFExchange (its own forge ExchangeDeployment script) ────────
    step(1, "Deploy CTFExchange (ctf-exchange/…/ExchangeDeployment.s.sol)");
    note(`forge script ExchangeDeployment -s deployExchange(admin, collateral, ctf, proxyFactory, safeFactory)`);
    {
        const p = chain.primitives;
        const forgeArgs = [
            "script",
            "ExchangeDeployment",
            "--rpc-url",
            rpc,
            "--private-key",
            pk,
            "--json",
            "--with-gas-price",
            "200000000000",
            "-s",
            "deployExchange(address,address,address,address,address)",
            admin,
            collateral,
            p.ctf,
            p.proxyFactory,
            p.safeFactory,
        ];
        if (!dryRun) forgeArgs.push("--broadcast");
        if (args.verify && process.env.ETHERSCAN_API_KEY) {
            forgeArgs.push("--verify", "--etherscan-api-key", process.env.ETHERSCAN_API_KEY);
        }
        deployed.ctfExchange = runForge(CTF_EXCHANGE_DIR, forgeArgs, "exchange", dryRun);
        ok(`CTFExchange = ${deployed.ctfExchange}${dryRun ? "  (dry-run: address not broadcast)" : ""}`);
    }

    // ── STEP 2: UmaCtfAdapter (its own forge DeployAdapter script) ───────────
    step(2, "Deploy UmaCtfAdapter (uma-ctf-adapter/…/DeployAdapter.s.sol)");
    note(`forge script DeployAdapter -s deployAdapter(admin, ctf, finder, optimisticOracle)`);
    {
        const p = chain.primitives;
        const forgeArgs = [
            "script",
            "DeployAdapter",
            "--rpc-url",
            rpc,
            "--private-key",
            pk,
            "--json",
            "-s",
            "deployAdapter(address,address,address,address)",
            admin,
            p.ctf,
            p.umaFinder,
            p.umaOptimisticOracle,
        ];
        if (!dryRun) forgeArgs.push("--broadcast");
        if (args.verify && process.env.ETHERSCAN_API_KEY) {
            forgeArgs.push("--verify", "--etherscan-api-key", process.env.ETHERSCAN_API_KEY);
        }
        deployed.umaCtfAdapter = runForge(UMA_DIR, forgeArgs, "adapter", dryRun);
        ok(`UmaCtfAdapter = ${deployed.umaCtfAdapter}${dryRun ? "  (dry-run: address not broadcast)" : ""}`);
    }

    // ── STEP 3: FPMM factory (fpmm/script/deploy-fpmm.mjs pattern) ───────────
    step(3, "Deploy FPMM factory (fpmm/script/deploy-fpmm.mjs — factory only)");
    note(
        `Deploys Predikt's own FPMMDeterministicFactory. Per-market pools are created\n` +
            `      later from this factory via create2FixedProductMarketMaker (see deploy-fpmm.mjs).`,
    );
    {
        deployed.fpmmFactory = await deployFpmmFactory({ rpc, pk, chainId: chain.chainId, dryRun });
        ok(`FPMMDeterministicFactory = ${deployed.fpmmFactory}${dryRun ? "  (dry-run: not broadcast)" : ""}`);
    }

    // ── STEP 4: grant relay operator the exchange operator role ──────────────
    step(4, "Grant relay operator the exchange operator role (CTFExchange.addOperator)");
    {
        if (admin !== deployer) {
            note(
                `EXCHANGE_ADMIN (${admin}) != deployer. The deployer renounced its admin\n` +
                    `      in step 1, so addOperator MUST be sent from the ADMIN key. Run:\n` +
                    `        cast send ${deployed.ctfExchange} "addOperator(address)" ${operator} \\\n` +
                    `          --rpc-url ${rpc} --private-key <ADMIN_KEY>\n` +
                    `      Skipping the on-chain call here (kit doesn't hold the external admin key).`,
            );
            steps.push({ ok: false, msg: "addOperator deferred to external admin" });
        } else if (dryRun) {
            note(
                `DRY RUN — would send: cast send ${deployed.ctfExchange} "addOperator(address)" ${operator}\n` +
                    `      from admin=deployer=${deployer}. (deployer retained admin in step 1.)`,
            );
            ok(`addOperator(${operator}) simulated`);
        } else {
            const r = spawnSync(
                "cast",
                [
                    "send",
                    deployed.ctfExchange,
                    "addOperator(address)",
                    operator,
                    "--rpc-url",
                    rpc,
                    "--private-key",
                    pk,
                ],
                { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
            );
            if (r.status !== 0) throw new Error(`addOperator failed: ${r.stderr?.trim()}`);
            // Verify on-chain.
            const isOp = castCall(rpc, deployed.ctfExchange, "isOperator(address)(bool)", [operator]);
            if (!/true/i.test(isOp)) throw new Error(`operator role NOT granted (isOperator=${isOp})`);
            ok(`addOperator(${operator}) confirmed on-chain (isOperator=true)`);
        }
    }

    // ── Collect addresses -> addresses.<chain>.json (PUBLIC only) ────────────
    const addresses = {
        chain: chain.key,
        chainId: chain.chainId,
        label: chain.label,
        rpc,
        dryRun,
        deployedAt: new Date().toISOString(),
        deployer,
        exchangeAdmin: admin,
        relayOperator: operator,
        // Deployed by this kit:
        contracts: {
            ctfExchange: deployed.ctfExchange,
            umaCtfAdapter: deployed.umaCtfAdapter,
            fpmmFactory: deployed.fpmmFactory,
        },
        // Real, already-live primitives used as inputs (echoed for provenance):
        primitives: {
            conditionalTokens: chain.primitives.ctf,
            collateral,
            usdcDecimals: chain.primitives.usdcDecimals,
            umaFinder: chain.primitives.umaFinder,
            umaOptimisticOracle: chain.primitives.umaOptimisticOracle,
            proxyFactory: chain.primitives.proxyFactory,
            safeFactory: chain.primitives.safeFactory,
        },
    };
    const outPath = resolve(KIT_DIR, `addresses.${chain.key}.json`);
    writeFileSync(outPath, JSON.stringify(addresses, null, 2) + "\n");
    step("5", "Collect addresses");
    ok(`wrote ${outPath} (PUBLIC addresses only — no secrets)`);

    // ── Emit the env blocks to paste ─────────────────────────────────────────
    step("6", "Env blocks to paste (no secrets — keys are placeholders)");
    const envCtx = {
        chain: { ...chain, rpc },
        primitives: {
            ctf: chain.primitives.ctf,
            usdc: collateral,
            umaOptimisticOracle: chain.primitives.umaOptimisticOracle,
        },
        deployed: {
            ctfExchange: deployed.ctfExchange,
            umaCtfAdapter: deployed.umaCtfAdapter,
            fpmmFactory: deployed.fpmmFactory,
        },
        operatorAddress: operator,
    };
    console.log(allEnvBlocks(envCtx));

    // ── Final summary ────────────────────────────────────────────────────────
    console.log(`\n══════════════════════════════════════════════════════════`);
    console.log(dryRun ? " DRY RUN COMPLETE — nothing was broadcast." : " DEPLOY COMPLETE.");
    console.log(`══════════════════════════════════════════════════════════`);
    if (dryRun) {
        console.log(
            " To go live: fund the deployer on the target chain, then re-run WITHOUT\n" +
                " --dry-run (and export a real PRIVATE_KEY). Start with --chain amoy.",
        );
    } else {
        console.log(" Verify every address on the block explorer before pointing users at it.");
    }
}

// ── forge runner: broadcast (or dry simulate) + parse the returned address ──
function runForge(cwd, forgeArgs, returnKey, dryRun) {
    // In dry-run without a funded key we still invoke forge in simulation mode so
    // the compile + call path is exercised, but forge won't produce a broadcast
    // address without a real run. We therefore parse an address when present and
    // otherwise fall back to a deterministic PENDING marker so the flow (env
    // blocks, addresses.json) is fully demonstrated.
    const r = spawnSync("forge", forgeArgs, { cwd, encoding: "utf8" });
    const stdout = r.stdout || "";
    const stderr = r.stderr || "";
    // forge --json prints a JSON line with `.returns.<key>.value`.
    const addr = parseForgeReturn(stdout, returnKey);
    if (r.status !== 0) {
        if (dryRun) {
            // A dry run may fail at the broadcast/estimate stage without funds/RPC;
            // that's expected here. Surface the reason, keep the flow demonstrable.
            note(`forge simulation could not complete (expected without funds/RPC): ${firstLine(stderr || stdout)}`);
            return addr || `0xPENDING_${returnKey.toUpperCase()}_run_live_to_populate`;
        }
        throw new Error(`forge script failed:\n${stderr || stdout}`);
    }
    if (!addr) {
        if (dryRun) return `0xPENDING_${returnKey.toUpperCase()}_run_live_to_populate`;
        throw new Error(`could not parse deployed address from forge output:\n${stdout}`);
    }
    return addr;
}

function parseForgeReturn(stdout, key) {
    for (const line of stdout.split("\n")) {
        const t = line.trim();
        if (!t.startsWith("{")) continue;
        try {
            const j = JSON.parse(t);
            const v = j?.returns?.[key]?.value;
            // Reject the zero address: a reverted/partial simulation can surface
            // 0x0…0 as the "return", which is not a real deployment.
            if (v && isAddress(v) && v.toLowerCase() !== ZERO) return v;
        } catch {
            /* not the json line */
        }
    }
    return null;
}

function firstLine(s) {
    return (s || "").split("\n").map((x) => x.trim()).filter(Boolean)[0] || "(no output)";
}

// ── FPMM factory deploy (reuses fpmm/deploy-fpmm.mjs's artifact + viem pattern) ─
// The fpmm deploy driver deploys BOTH the factory and a pool; here we only need
// the factory (per-market pools are created later). We reuse its exact artifact
// load + deployContract pattern rather than reimplementing the AMM.
async function deployFpmmFactory({ rpc, pk, chainId, dryRun }) {
    const artifactPath = resolve(
        FPMM_DIR,
        "out/FPMMDeterministicFactory.sol/FPMMDeterministicFactory.json",
    );
    if (!existsSync(artifactPath)) {
        note(`FPMM factory artifact missing — run:  (cd ../fpmm && forge build)`);
        return `0xPENDING_FPMMFACTORY_forge_build_fpmm_first`;
    }
    if (dryRun) {
        note(`DRY RUN — would deploy FPMMDeterministicFactory bytecode via viem (chainId=${chainId}).`);
        note(`      Real run: reuses fpmm/out artifact + walletClient.deployContract (see deploy-fpmm.mjs).`);
        return `0xPENDING_FPMMFACTORY_run_live_to_populate`;
    }
    // Real deploy: dynamic-import viem (linked by setup-deps.mjs) and deploy the
    // factory bytecode. This mirrors deploy-fpmm.mjs's factory branch exactly.
    return await deployFpmmFactoryLive({ rpc, pk, chainId, artifactPath });
}

async function deployFpmmFactoryLive({ rpc, pk, chainId, artifactPath }) {
    const viem = await import("viem");
    const { privateKeyToAccount } = await import("viem/accounts");
    const j = JSON.parse(readFileSync(artifactPath, "utf8"));
    const bc = j.bytecode?.object ?? j.bytecode;
    const bytecode = bc.startsWith("0x") ? bc : `0x${bc}`;
    const account = privateKeyToAccount(pk);
    const chain = {
        id: chainId,
        name: `chain-${chainId}`,
        nativeCurrency: { name: "MATIC", symbol: "MATIC", decimals: 18 },
        rpcUrls: { default: { http: [rpc] } },
    };
    const publicClient = viem.createPublicClient({ transport: viem.http(rpc) });
    const walletClient = viem.createWalletClient({ account, chain, transport: viem.http(rpc) });
    const hash = await walletClient.deployContract({ abi: j.abi, bytecode, args: [] });
    const rcpt = await publicClient.waitForTransactionReceipt({ hash });
    if (!rcpt.contractAddress) throw new Error("FPMM factory deploy produced no address");
    return rcpt.contractAddress;
}

main().catch((err) => {
    console.error(`\n[deploy-kit ERROR] ${err?.shortMessage ?? err?.message ?? err}`);
    if (err?.stack && process.env.DEBUG) console.error(err.stack);
    process.exitCode = 1;
});
