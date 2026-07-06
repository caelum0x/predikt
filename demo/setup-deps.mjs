// Make the demo runnable without a separate install.
//
// The demo needs `viem` (+ its runtime closure) and `@predikt/orders`. Rather
// than duplicate a full install, we reuse the sibling predikt-relay's already
// installed node_modules by symlinking the exact packages we need into this
// folder's node_modules. Idempotent — run it as often as you like.

import { existsSync, mkdirSync, symlinkSync, rmSync, lstatSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RELAY_NM = resolve(__dirname, "../predikt-relay/node_modules");
const LOCAL_NM = resolve(__dirname, "node_modules");

// viem's runtime dependency closure (viem 2.x) + the Predikt order-signing SDK.
const PKGS = ["viem", "abitype", "ox", "@noble", "@scure", "@adraffy", "@predikt"];

function safeLstat(p) {
    try {
        return lstatSync(p);
    } catch {
        return null;
    }
}

function link(pkg) {
    const src = resolve(RELAY_NM, pkg);
    const dst = resolve(LOCAL_NM, pkg);
    if (!existsSync(src)) {
        console.error(
            `[setup-deps] MISSING: ${src}\n` +
                `  Install the relay deps first:  (cd ../predikt-relay && npm install)`,
        );
        process.exitCode = 1;
        return;
    }
    if (pkg.includes("/")) mkdirSync(dirname(dst), { recursive: true });
    try {
        if (existsSync(dst) || safeLstat(dst)) rmSync(dst, { recursive: true, force: true });
    } catch {
        /* ignore */
    }
    symlinkSync(src, dst, "dir");
}

mkdirSync(LOCAL_NM, { recursive: true });
for (const p of PKGS) link(p);

if (process.exitCode) {
    console.error("[setup-deps] failed — see missing packages above.");
} else {
    console.log("[setup-deps] viem + @predikt/orders linked from predikt-relay/node_modules");
}
