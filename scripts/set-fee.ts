/**
 * Owner-only platform fee change. v4 timelocks it: a proposal takes effect after 48 hours, so
 * receipts viewers already signed settle at the rate they saw. Uses SETTLER_PRIVATE_KEY (the owner).
 *   npx tsx scripts/set-fee.ts 500     # propose 5% (bps; max 1000, and fee + referral <= 1500)
 *   npx tsx scripts/set-fee.ts apply   # after 48 hours: make the proposal effective
 */
import { existsSync, readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arc } from "../lib/chain";
import { ppwAbi, PPW_ADDRESS } from "../lib/contract";

for (const file of [".env.local", ".env"]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

async function main() {
  const arg = process.argv[2];
  const account = privateKeyToAccount(process.env.SETTLER_PRIVATE_KEY as Hex);
  const pub = createPublicClient({ chain: arc, transport: http() });
  const wallet = createWalletClient({ account, chain: arc, transport: http() });
  const read = <T>(functionName: "feeBps" | "pendingFeeBps" | "pendingFeeApplicableAt") =>
    pub.readContract({ address: PPW_ADDRESS, abi: ppwAbi, functionName }) as Promise<T>;
  let hash: Hex;
  if (arg === "apply") {
    hash = await wallet.writeContract({ address: PPW_ADDRESS, abi: ppwAbi, functionName: "applyFee" });
  } else {
    const bps = Number(arg);
    if (!Number.isInteger(bps) || bps < 0 || bps > 1000) throw new Error("Pass a fee in bps (0-1000), or `apply`");
    hash = await wallet.writeContract({ address: PPW_ADDRESS, abi: ppwAbi, functionName: "proposeFee", args: [bps] });
  }
  await pub.waitForTransactionReceipt({ hash });
  const [fee, pending, at] = await Promise.all([read<number>("feeBps"), read<number>("pendingFeeBps"), read<bigint>("pendingFeeApplicableAt")]);
  console.log(`tx ${hash}\nfeeBps now ${fee}${at > 0n ? `; ${pending} proposed, applies after ${new Date(Number(at) * 1000).toISOString()}` : ""}`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
