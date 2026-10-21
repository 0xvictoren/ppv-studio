/** Owner-only: set the platform fee. `npx tsx scripts/set-fee.ts 500` (bps; 500 = 5%). Uses SETTLER_PRIVATE_KEY (the owner). */
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
  const bps = Number(process.argv[2]);
  if (!Number.isInteger(bps) || bps < 0 || bps > 1000) throw new Error("Pass a fee in bps, 0-1000");
  const account = privateKeyToAccount(process.env.SETTLER_PRIVATE_KEY as Hex);
  const pub = createPublicClient({ chain: arc, transport: http() });
  const wallet = createWalletClient({ account, chain: arc, transport: http() });
  const before = await pub.readContract({ address: PPW_ADDRESS, abi: ppwAbi, functionName: "feeBps" });
  const hash = await wallet.writeContract({ address: PPW_ADDRESS, abi: ppwAbi, functionName: "setFee", args: [bps] });
  await pub.waitForTransactionReceipt({ hash });
  const after = await pub.readContract({ address: PPW_ADDRESS, abi: ppwAbi, functionName: "feeBps" });
  console.log(`feeBps ${before} -> ${after}  tx ${hash}`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
