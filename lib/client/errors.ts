import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from "viem";
import { RevertError } from "./ppw";

const MESSAGES: Record<string, string> = {
  InsufficientBalance: "Not enough USDC in your PayPerWatch balance.",
  InvalidAmount: "Enter an amount greater than $0.",
  InvalidPrice: "Price must be more than $0 and at most $100 per hour.",
  VideoAlreadyExists: "This video is already registered.",
  NotCreator: "Only the creator of this video can do that.",
  WithdrawDelayNotMet: "Your withdrawal isn't ready yet. We're settling your final watch time.",
  SessionKeyExpired: "Your watch session expired. Add funds to start a new one.",
  SessionCapExceeded: "Your session spending limit is used up. Add funds to keep watching.",
  InvalidSignature: "The signature didn't check out.",
  ReceiptExpired: "That receipt expired.",
  EnforcedPause: "PayPerWatch is paused for maintenance. Withdrawals still work.",
  FeeTooHigh: "Fee is above the 10% maximum.",
  ZeroAddress: "Missing address.",
  ERC20InsufficientBalance: "Not enough USDC in your wallet.",
  ERC20InsufficientAllowance: "USDC approval is too low. Approve and try again.",
  SafeERC20FailedOperation: "The USDC transfer failed. Check your wallet balance.",
};

/** Plain-language message for any wallet / contract / network error. */
export function friendlyError(e: unknown): string {
  if (e instanceof RevertError) return MESSAGES[e.errorName] ?? `Transaction failed (${e.errorName}).`;
  if (e instanceof BaseError) {
    if (e.walk((x) => x instanceof UserRejectedRequestError)) return "You cancelled the request in your wallet.";
    const revert = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    const name = revert?.data?.errorName;
    if (name && MESSAGES[name]) return MESSAGES[name];
    if (/insufficient funds/i.test(e.message)) return "Not enough USDC in your wallet to pay for gas.";
    return e.shortMessage || e.message;
  }
  if (e instanceof Error) {
    if (/user rejected|denied/i.test(e.message)) return "You cancelled the request in your wallet.";
    return e.message;
  }
  return "Something went wrong. Please try again.";
}
