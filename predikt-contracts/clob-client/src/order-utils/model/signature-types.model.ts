export enum SignatureType {
    /**
     * ECDSA EIP712 signatures signed by EOAs
     */
    EOA = 0,

    /**
     * EIP712 signatures signed by EOAs that own Polymarket Proxy wallets
     */
    POLY_PROXY = 1,

    /**
     * EIP712 signatures signed by EOAs that own Polymarket Gnosis safes
     */
    POLY_GNOSIS_SAFE = 2,

    /**
     * EIP-1271 signatures verified by a smart-contract wallet's isValidSignature.
     * Mirrors OrderStructs.sol `SignatureType.POLY_1271`; the relay is the single
     * source of truth consumer of this enum.
     */
    POLY_1271 = 3,
}
