/**
 * Generate a cryptographically-random uint256 order salt.
 *
 * Uses the platform CSPRNG (`globalThis.crypto.getRandomValues`) over 32 random
 * bytes rather than `Math.random()`, so salts are unpredictable and collision-
 * resistant (order hashes must be unique per maker). The return type is a decimal
 * string, matching the on-chain `salt` uint256 field and the SDK order shape.
 */
export function generateOrderSalt(): string {
    const bytes = new Uint8Array(32);
    globalThis.crypto.getRandomValues(bytes);
    let salt = 0n;
    for (const b of bytes) salt = (salt << 8n) | BigInt(b);
    return salt.toString();
}
