import type { ClobSigner } from "../signer.ts";
import { signTypedDataWithSigner } from "../signer.ts";

/**
 * Canonical EIP-712 "Cancel" typed message used to authenticate off-chain order
 * cancellation against the Predikt relay.
 *
 * This is a DEDICATED relay-authentication message — it is NOT the on-chain
 * `Order` domain/struct (which must never change) and is never submitted to any
 * contract. Its only purpose is to let the relay cryptographically prove that a
 * `DELETE /orders/:hash` request was authorised by the order's maker.
 *
 * The relay is the single source of truth for this shape; the web client signs
 * exactly this domain + struct and the relay recovers the signer from it.
 */

/** The relay-scoped cancel domain name. */
export const CANCEL_DOMAIN_NAME = "Predikt Relay";
/** The relay-scoped cancel domain version. */
export const CANCEL_DOMAIN_VERSION = "1";

/** EIP-712 struct definition for the Cancel message. */
export const CANCEL_TYPES = {
    Cancel: [
        { name: "orderHash", type: "bytes32" },
        { name: "deadline", type: "uint256" },
    ],
} as const;

/** The Cancel message primary type name. */
export const CANCEL_PRIMARY_TYPE = "Cancel";

/** Payload authorising cancellation of a single order before `deadline`. */
export interface CancelMessage {
    /** The EIP-712 order hash of the resting order to cancel. */
    orderHash: string;
    /** Unix seconds after which this authorisation is no longer valid. */
    deadline: number;
}

/** Build the relay cancel EIP-712 domain for a given chain. */
export function cancelDomain(chainId: number): {
    name: string;
    version: string;
    chainId: number;
} {
    return {
        name: CANCEL_DOMAIN_NAME,
        version: CANCEL_DOMAIN_VERSION,
        chainId,
    };
}

/**
 * Sign the canonical Cancel message with the maker's signer, producing the
 * signature the relay expects on `DELETE /orders/:hash`.
 */
export async function signCancel(
    signer: ClobSigner,
    params: { chainId: number; orderHash: string; deadline: number },
): Promise<string> {
    return signTypedDataWithSigner({
        signer,
        domain: cancelDomain(params.chainId),
        types: CANCEL_TYPES as unknown as Record<
            string,
            Array<{ name: string; type: string }>
        >,
        value: { orderHash: params.orderHash, deadline: params.deadline },
        primaryType: CANCEL_PRIMARY_TYPE,
    });
}
