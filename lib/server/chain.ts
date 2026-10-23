import "server-only";
import { createPublicClient, createWalletClient, http, parseAbiItem, parseEventLogs, type Address, type Hex } from "viem";
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

// settleBatch (v4) reverts the whole tx when a receipt would run short of gas, instead of
// skipping it, so eth_estimateGas now covers every entry. Add headroom for state changes between
// estimate and inclusion. Receipts that fail for real (bad signature, expired) are still skipped
// and reported through SettlementSkipped.
const GAS_HEADROOM_PCT = 125n;
const settlementSkipped = parseAbiItem("event SettlementSkipped(uint256 indexed index, bytes4 reason)");

/**
 * Submit settleBatch with the server-only settler key. Returns the tx hash and the batch indexes
 * the contract skipped (bad signature, expired, over the session cap...), which were not paid.
 * Throws if the whole batch can't go through (e.g. a receipt whose wallet burns all the gas).
 */
export async function submitSettleBatch(receipts: Receipt[], sigs: Hex[]): Promise<{ hash: Hex; skipped: { index: number; reason: Hex }[] }> {
  if (isMock) return { hash: await mock.settleBatch(receipts, sigs), skipped: [] };
  const pk = process.env.SETTLER_PRIVATE_KEY as Hex | undefined;
  if (!pk) throw new Error("SETTLER_PRIVATE_KEY is not set");
  const account = privateKeyToAccount(pk);
  const wallet = createWalletClient({ account, chain: arc, transport: http() });
  const call = { account, address: PPW_ADDRESS, abi: ppwAbi, functionName: "settleBatch", args: [receipts, sigs] } as const;
  const estimate = await publicClient.estimateContractGas(call);
  const { request } = await publicClient.simulateContract({ ...call, gas: (estimate * GAS_HEADROOM_PCT) / 100n });
  const hash = await wallet.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const skipped = parseEventLogs({ abi: [settlementSkipped], logs: receipt.logs })
    .filter((l) => l.address.toLowerCase() === PPW_ADDRESS.toLowerCase())
    .map((l) => ({ index: Number(l.args.index), reason: l.args.reason }));
  return { hash, skipped };
}

/**
 * Pull accrued platform fees to the fee recipient once they reach `min` (v4 keeps fees in the
 * contract instead of pushing them during settlement). Anyone may call withdrawFees; the settler does.
 */
export async function withdrawPlatformFees(min: bigint): Promise<Hex | null> {
  const accrued = await readPpw<bigint>("feesAccrued");
  if (accrued === 0n || accrued < min) return null;
  if (isMock) return mock.write("withdrawFees", [], "0x0000000000000000000000000000000000000001");
  const pk = process.env.SETTLER_PRIVATE_KEY as Hex | undefined;
  if (!pk) throw new Error("SETTLER_PRIVATE_KEY is not set");
  const account = privateKeyToAccount(pk);
  const wallet = createWalletClient({ account, chain: arc, transport: http() });
  const { request } = await publicClient.simulateContract({ account, address: PPW_ADDRESS, abi: ppwAbi, functionName: "withdrawFees" });
  const hash = await wallet.writeContract(request);
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}
