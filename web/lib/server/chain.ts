import "server-only";
import { createPublicClient, createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arc } from "../chain";
import { erc20Abi, ppwAbi, PPW_ADDRESS, USDC_ADDRESS, type PpwReadFn, type Receipt } from "../contract";
import { isMock } from "../env";
import * as mock from "../mock/contract";

export const publicClient = createPublicClient({ chain: arc, transport: http() });

/** Read a PayPerWatch view, from the mock or the chain. */
export async function readPpw<T = unknown>(fn: PpwReadFn, args: unknown[] = []): Promise<T> {
  if (isMock) return mock.read(fn, args) as T;
  return (await publicClient.readContract({
    address: PPW_ADDRESS,
    abi: ppwAbi,
    functionName: fn,
    args: args as never,
  })) as T;
}

export async function readUsdcBalance(owner: Address): Promise<bigint> {
  if (isMock) return mock.read("usdc.balanceOf", [owner]) as bigint;
  return publicClient.readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [owner] });
}

/** Is `key` an unexpired session key authorized by `viewer`? */
export async function isActiveSessionKey(viewer: Address, key: Address): Promise<boolean> {
  const [expiry] = await readPpw<readonly [bigint, bigint, bigint]>("sessionKeys", [viewer, key]);
  return expiry > BigInt(Math.floor(Date.now() / 1000));
}

/** Submit settleBatch with the server-only settler key. Returns the tx hash. */
export async function submitSettleBatch(receipts: Receipt[], sigs: Hex[]): Promise<Hex> {
  if (isMock) return mock.settleBatch(receipts, sigs);
  const pk = process.env.SETTLER_PRIVATE_KEY as Hex | undefined;
  if (!pk) throw new Error("SETTLER_PRIVATE_KEY is not set");
  const account = privateKeyToAccount(pk);
  const wallet = createWalletClient({ account, chain: arc, transport: http() });
  const { request } = await publicClient.simulateContract({
    account,
    address: PPW_ADDRESS,
    abi: ppwAbi,
    functionName: "settleBatch",
    args: [receipts, sigs],
  });
  const hash = await wallet.writeContract(request);
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}
