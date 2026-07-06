/**
 * @predikt/orders — build and EIP-712 sign a real order for the Predikt CTF Exchange.
 *
 * This is the core the SDK exists for: no hosted HTTP client, just real order
 * construction + signing that the on-chain CTFExchange (matchOrders/fillOrder)
 * will accept. Run against the deployed exchange address for your chain.
 */
import { Wallet } from "@ethersproject/wallet";
import { OrderBuilder, OrderSide, SignatureType } from "../src/index.ts";

async function main(): Promise<void> {
    const pk = process.env.PK;
    if (!pk) throw new Error("Set PK to a funded private key (see .env.example)");

    const signer = new Wallet(pk);
    const chainId = 137; // Polygon mainnet

    const builder = new OrderBuilder(
        signer,
        chainId,
        SignatureType.EOA,
        // funderAddress omitted -> defaults to the signer address
    );

    // Build + sign a limit order. The signature is a real EIP-712 signature over
    // the "Polymarket CTF Exchange" v1 domain that the on-chain contract verifies.
    const signedOrder = await builder.buildOrder(
        {
            tokenID: "<CTF outcome token id>",
            price: 0.55,
            side: OrderSide.BUY,
            size: 100,
        },
        { tickSize: "0.01", negRisk: false },
    );

    // signedOrder is ready to be matched on-chain via CTFExchange.matchOrders / fillOrder.
    console.log(JSON.stringify(signedOrder, null, 2));
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
