import { parseUnits, type Hex, type WalletClient } from "viem";
import type { SignedOrder, OrderData, ClobSigner } from "@predikt/orders";
import { ExchangeOrderBuilder, OrderSide, SignatureType } from "@predikt/orders";
import type { Level } from "./pricing.ts";

// Both collateral (USDC) and the ERC1155 outcome tokens use 6 decimals in this
// deployment (COLLATERAL_TOKEN_DECIMALS / CONDITIONAL_TOKEN_DECIMALS = 6 in the
// SDK config), so every amount is scaled by 1e6.
const DECIMALS = 6;

function toUnits(value: number): bigint {
    // Round to the token precision before scaling so floating mid/size never
    // produces a fractional base unit (which parseUnits would reject).
    return parseUnits(value.toFixed(DECIMALS), DECIMALS);
}

/**
 * Build the OrderData (pre-signature) for one ladder level on `tokenId`.
 *
 * BUY  size shares @ p: maker supplies p*size USDC, wants size shares.
 * SELL size shares @ p: maker supplies size shares, wants p*size USDC.
 *
 * The relay's priceWad (makerAmount/takerAmount for BUY, takerAmount/makerAmount
 * for SELL) reduces to exactly `p` in both cases, so a BUY level rests below mid
 * and a SELL level above, as intended.
 */
export function levelToOrderData(maker: Hex, tokenId: bigint, level: Level): OrderData {
    const shares = toUnits(level.size);
    const usdc = toUnits(level.price * level.size);
    const isBuy = level.side === "BUY";
    return {
        maker,
        signer: maker,
        taker: "0x0000000000000000000000000000000000000000",
        tokenId: tokenId.toString(),
        makerAmount: (isBuy ? usdc : shares).toString(),
        takerAmount: (isBuy ? shares : usdc).toString(),
        side: isBuy ? OrderSide.BUY : OrderSide.SELL,
        feeRateBps: "0",
        nonce: "0",
        expiration: "0",
        signatureType: SignatureType.EOA,
    };
}

/**
 * Sign one ladder level into a relay-submittable SignedOrder. Uses the SDK's
 * ExchangeOrderBuilder bound to the exchange address + chainId, which produces
 * the correct EIP-712 domain ("Polymarket CTF Exchange"/"1"), a CSPRNG salt
 * (generateOrderSalt), the EOA signatureType, and the maker's ECDSA signature.
 */
export async function signLevel(
    signer: WalletClient,
    exchangeAddress: Hex,
    chainId: number,
    maker: Hex,
    tokenId: bigint,
    level: Level,
): Promise<SignedOrder> {
    const builder = new ExchangeOrderBuilder(
        exchangeAddress,
        chainId,
        signer as unknown as ClobSigner,
    );
    return builder.buildSignedOrder(levelToOrderData(maker, tokenId, level));
}
