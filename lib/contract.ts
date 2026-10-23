import { encodePacked, keccak256, parseAbi, type Address, type Hex } from "viem";
import { ppwAbi } from "./abi/PayPerWatch";
import { env } from "./env";

// Single place for the contract address + ABI. Swap lib/abi/PayPerWatch.ts and set
// NEXT_PUBLIC_PPW_CONTRACT to go from mock mode to the deployed contract.
export { ppwAbi };
export const PPW_ADDRESS = env.ppwAddress;
export const USDC_ADDRESS = env.usdcAddress;

export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "event Approval(address indexed owner, address indexed spender, uint256 value)",
]);

export type Receipt = {
  viewer: Address;
  creator: Address;
  /** Who referred this viewer (zero address = nobody). Cumulative amounts are per (viewer, creator, referrer). */
  referrer: Address;
  cumulativeAmount: bigint;
  deadline: bigint;
};

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
/** Referrers earn 5% of a referred viewer's spend, paid from the creator's share (onchain referralBps; owner-adjustable up to 10%). */
export const REFERRAL_BPS = 500n;
export const REFERRAL_LABEL = `${Number(REFERRAL_BPS) / 100}%`;

// Must match the contract's EIP-712 domain exactly.
export const eip712Domain = {
  name: "PayPerWatch",
  version: "4",
  chainId: env.chainId,
  verifyingContract: PPW_ADDRESS,
} as const;

export const receiptTypes = {
  Receipt: [
    { name: "viewer", type: "address" },
    { name: "creator", type: "address" },
    { name: "referrer", type: "address" },
    { name: "cumulativeAmount", type: "uint256" },
    { name: "deadline", type: "uint64" },
  ],
} as const;

export function computeVideoId(creator: Address, contentCid: string): Hex {
  return keccak256(encodePacked(["address", "string"], [creator, contentCid]));
}

/** Names of state-changing contract functions, used by the tx layer and the mock. */
export type PpwWriteFn =
  | "registerVideo"
  | "updatePrice"
  | "setVideoActive"
  | "deposit"
  | "depositAndAuthorize"
  | "authorizeSessionKey"
  | "revokeSessionKey"
  | "requestWithdraw"
  | "withdraw"
  | "cancelWithdraw";

export type PpwReadFn = "videos" | "balanceOf" | "settled" | "paidTo" | "pendingWithdrawal" | "sessionKeys" | "feeBps" | "feesAccrued" | "WITHDRAW_DELAY";

/** JSON-safe event as served by /api/events (bigints are strings). */
export type PpwEvent = {
  name: string;
  args: Record<string, string | boolean>;
  txHash: Hex;
  blockNumber: string;
  timestamp: number; // unix seconds
};
