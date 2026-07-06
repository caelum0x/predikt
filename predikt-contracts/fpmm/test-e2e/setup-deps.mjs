// Make the e2e harness runnable without a network install.
//
// The harness needs `viem` (+ its runtime deps). Rather than duplicate a full
// install, we reuse the sibling predikt-relay's already-installed node_modules
// by symlinking the exact packages viem needs into this folder's node_modules.
// If the relay hasn't been installed, we print a clear instruction instead of
// failing cryptically.
//
// This is idempotent: run it as many times as you like.

import { existsSync, mkdirSync, symlinkSync, rmSync, lstatSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RELAY_NM = resolve(__dirname, "../../../predikt-relay/node_modules");
// Link into BOTH the e2e folder (for test-e2e/run.mjs) and the fpmm root
// (for script/deploy-fpmm.mjs). The fpmm-root node_modules already contains
// @gnosis.pm + openzeppelin-solidity used by the forge build; we only add the
// viem closure and never touch those.
const TARGET_NM = [resolve(__dirname, "node_modules"), resolve(__dirname, "../node_modules")];

// viem's runtime dependency closure (viem 2.x).
const PKGS = ["viem", "abitype", "ox", "@noble", "@scure", "@adraffy"];

function link(pkg, LOCAL_NM) {
    const src = resolve(RELAY_NM, pkg);
    const dst = resolve(LOCAL_NM, pkg);
    if (!existsSync(src)) {
        console.error(
            `[setup-deps] MISSING: ${src}\n` +
                `  Install the relay deps first:  (cd ../../predikt-relay && npm install)`,
        );
        process.exitCode = 1;
        return;
    }
    // scoped packages (@noble) need the @scope dir to exist
    if (pkg.includes("/")) mkdirSync(dirname(dst), { recursive: true });
    try {
        if (existsSync(dst) || safeLstat(dst)) rmSync(dst, { recursive: true, force: true });
    } catch {
        /* ignore */
    }
    symlinkSync(src, dst, "dir");
}

function safeLstat(p) {
    try {
        return lstatSync(p);
    } catch {
        return null;
    }
}

for (const LOCAL_NM of TARGET_NM) {
    mkdirSync(LOCAL_NM, { recursive: true });
    for (const p of PKGS) link(p, LOCAL_NM);
}

if (process.exitCode) {
    console.error("[setup-deps] failed — see missing packages above.");
} else {
    console.log("[setup-deps] viem + deps linked from predikt-relay/node_modules");
}
