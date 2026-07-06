import {
    createPublicClient,
    createWalletClient,
    http,
    maxUint256,
    type Account,
    type Hex,
    type PublicClient,
    type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { MarketMakerConfig } from "./config.ts";
import { CTF_SPLIT_ABI, ERC1155_MM_ABI, ERC20_MM_ABI, EXCHANGE_VIEW_ABI } from "./abi.ts";

// Binary-condition full-set partition: index-set 1 (YES) + index-set 2 (NO).
const BINARY_PARTITION = [1n, 2n] as const;
const ZERO_BYTES32: Hex = `0x${"0".repeat(64)}`;

// Thin viem wrapper for the maker account: the real balance/allowance/approval
// reads that gate whether a side can be quoted, plus the real approve /
// setApprovalForAll / splitPosition writes used to fund and mint. No mocks —
// every method hits the configured RPC / contracts.
export class MarketMakerChain {
    readonly publicClient: PublicClient;
    readonly walletClient: WalletClient;
    readonly account: Account;
    readonly exchange: Hex;
    readonly usdc: Hex;
    readonly ctf: Hex;

    constructor(cfg: MarketMakerConfig) {
        this.account = privateKeyToAccount(cfg.privateKey);
        this.exchange = cfg.exchangeAddress;
        this.usdc = cfg.usdcAddress;
        this.ctf = cfg.ctfAddress;
        const transport = http(cfg.rpcUrl);
        this.publicClient = createPublicClient({ transport });
        this.walletClient = createWalletClient({ account: this.account, transport });
    }

    get address(): Hex {
        return this.account.address;
    }

    async usdcBalanceAndAllowance(): Promise<{ balance: bigint; allowance: bigint }> {
        const [balance, allowance] = await Promise.all([
            this.publicClient.readContract({
                address: this.usdc,
                abi: ERC20_MM_ABI,
                functionName: "balanceOf",
                args: [this.address],
            }),
            this.publicClient.readContract({
                address: this.usdc,
                abi: ERC20_MM_ABI,
                functionName: "allowance",
                args: [this.address, this.exchange],
            }),
        ]);
        return { balance, allowance };
    }

    async ctfBalanceAndApproval(
        tokenId: bigint,
    ): Promise<{ balance: bigint; approved: boolean }> {
        const [balance, approved] = await Promise.all([
            this.publicClient.readContract({
                address: this.ctf,
                abi: ERC1155_MM_ABI,
                functionName: "balanceOf",
                args: [this.address, tokenId],
            }),
            this.publicClient.readContract({
                address: this.ctf,
                abi: ERC1155_MM_ABI,
                functionName: "isApprovedForAll",
                args: [this.address, this.exchange],
            }),
        ]);
        return { balance, approved };
    }

    /** Complement token id (NO for a YES, YES for a NO). 0 ⇒ not registered. */
    async getComplement(tokenId: bigint): Promise<bigint> {
        try {
            return await this.publicClient.readContract({
                address: this.exchange,
                abi: EXCHANGE_VIEW_ABI,
                functionName: "getComplement",
                args: [tokenId],
            });
        } catch {
            return 0n;
        }
    }

    /** Parent conditionId for a registered token; needed for splitPosition. */
    async getConditionId(tokenId: bigint): Promise<Hex> {
        return this.publicClient.readContract({
            address: this.exchange,
            abi: EXCHANGE_VIEW_ABI,
            functionName: "getConditionId",
            args: [tokenId],
        });
    }

    /** Approve the exchange to pull USDC (idempotent max approval). */
    async approveUsdc(): Promise<Hex> {
        const { request } = await this.publicClient.simulateContract({
            address: this.usdc,
            abi: ERC20_MM_ABI,
            functionName: "approve",
            args: [this.exchange, maxUint256],
            account: this.account,
        });
        return this.walletClient.writeContract(request);
    }

    /** Approve the exchange to move the maker's ERC1155 outcome tokens. */
    async approveCtf(): Promise<Hex> {
        const { request } = await this.publicClient.simulateContract({
            address: this.ctf,
            abi: ERC1155_MM_ABI,
            functionName: "setApprovalForAll",
            args: [this.exchange, true],
            account: this.account,
        });
        return this.walletClient.writeContract(request);
    }

    /**
     * Mint a full outcome-token set by locking `amount` (6dp) of USDC in the
     * ConditionalTokens contract via splitPosition on the given binary
     * condition. Yields `amount` of BOTH the YES and NO tokens, which the maker
     * can then quote SELL against. This is the real, simplest self-funding path
     * for SELL liquidity (see MARKETMAKER.md).
     */
    async splitPosition(conditionId: Hex, amount: bigint): Promise<Hex> {
        const { request } = await this.publicClient.simulateContract({
            address: this.ctf,
            abi: CTF_SPLIT_ABI,
            functionName: "splitPosition",
            args: [this.usdc, ZERO_BYTES32, conditionId, [...BINARY_PARTITION], amount],
            account: this.account,
        });
        return this.walletClient.writeContract(request);
    }

    async waitForTx(hash: Hex): Promise<void> {
        await this.publicClient.waitForTransactionReceipt({ hash });
    }
}
