"use client";

import { readContract, switchChain, getAccount, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import type { Address, Hex } from "viem";
import { arc } from "../chain";
import { erc20Abi, ppwAbi, PPW_ADDRESS, USDC_ADDRESS, type PpwReadFn, type PpwWriteFn } from "../contract";
import { isMock } from "../env";
import { api, reviveBigints } from "./api";
import { wagmiConfig } from "./wagmi";

// Browser-side contract client. Same API in mock mode (calls /api/mock/contract) and real
// mode (wagmi core actions against Arc).

export type WriteFn = PpwWriteFn | "usdc.approve";

export class RevertError extends Error {
  constructor(public errorName: string) {
    super(errorName);
  }
}

async function mockCall<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/mock/contract", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
  });
  const data = await res.json();
  if (data.revert) throw new RevertError(data.revert);
  if (!res.ok) throw new Error(data.error ?? "Mock chain error");
  return data;
}

export async function readPpw<T>(fn: PpwReadFn, args: unknown[] = [], contract: Address = PPW_ADDRESS): Promise<T> {
  if (isMock) return reviveBigints<T>((await mockCall<{ result: unknown }>({ op: "read", fn, args })).result);
  return (await readContract(wagmiConfig, { address: contract, abi: ppwAbi, functionName: fn, args: args as never })) as T;
}

export async function usdcBalance(owner: Address): Promise<bigint> {
  if (isMock) return reviveBigints((await mockCall<{ result: unknown }>({ op: "read", fn: "usdc.balanceOf", args: [owner] })).result);
  return readContract(wagmiConfig, { address: USDC_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [owner] });
}

export async function usdcAllowance(owner: Address): Promise<bigint> {
  if (isMock) return reviveBigints((await mockCall<{ result: unknown }>({ op: "read", fn: "usdc.allowance", args: [owner, owner] })).result);
  return readContract(wagmiConfig, { address: USDC_ADDRESS, abi: erc20Abi, functionName: "allowance", args: [owner, PPW_ADDRESS] });
}

/** Ask the wallet to sign + send. Resolves with the tx hash once the wallet accepts. */
/** `contract` overrides the target, e.g. to withdraw from an earlier deployment. */
export async function sendTx(fn: WriteFn, args: unknown[], from: Address, contract: Address = PPW_ADDRESS): Promise<Hex> {
  if (isMock) return (await mockCall<{ hash: Hex }>({ op: "write", fn, args, from })).hash;
  if (getAccount(wagmiConfig).chainId !== arc.id) await switchChain(wagmiConfig, { chainId: arc.id });
  if (fn === "usdc.approve") {
    return writeContract(wagmiConfig, {
      address: USDC_ADDRESS,
      abi: erc20Abi,
      functionName: "approve",
      args: [PPW_ADDRESS, args[1] as bigint],
      chainId: arc.id,
    });
  }
  return writeContract(wagmiConfig, {
    address: contract,
    abi: ppwAbi,
    functionName: fn,
    args: args as never,
    chainId: arc.id,
  } as never);
}

/** Wait for confirmation; throws if the transaction reverted. */
export async function waitTx(hash: Hex): Promise<void> {
  if (isMock) {
    await new Promise((r) => setTimeout(r, 600)); // feel of sub-second finality
    return;
  }
  const receipt = await waitForTransactionReceipt(wagmiConfig, { hash, chainId: arc.id });
  if (receipt.status !== "success") throw new Error("Transaction reverted");
}

export async function mockFastForwardWithdrawal(from: Address) {
  if (isMock) await mockCall({ op: "fastForwardWithdrawal", from });
}

export { api };
