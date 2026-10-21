/** Verify the frontend's EIP-712 receipt digest matches the deployed contract's hashReceipt(). */
import { createPublicClient, hashTypedData, http } from "viem";
import { arc } from "../lib/chain";
import { eip712Domain, ppwAbi, PPW_ADDRESS, receiptTypes } from "../lib/contract";

const client = createPublicClient({ chain: arc, transport: http() });
const r = {
  viewer: "0x1111111111111111111111111111111111111111",
  creator: "0x2222222222222222222222222222222222222222",
  referrer: "0x3333333333333333333333333333333333333333",
  cumulativeAmount: 123_456n,
  deadline: 1_900_000_000n,
} as const;

async function main() {
const local = hashTypedData({ domain: eip712Domain, types: receiptTypes, primaryType: "Receipt", message: r });
const onchain = await client.readContract({ address: PPW_ADDRESS, abi: ppwAbi, functionName: "hashReceipt", args: [r] });
const [fee, owner, usdc, video] = await Promise.all([
  client.readContract({ address: PPW_ADDRESS, abi: ppwAbi, functionName: "feeBps" }),
  client.readContract({ address: PPW_ADDRESS, abi: ppwAbi, functionName: "owner" }),
  client.readContract({ address: PPW_ADDRESS, abi: ppwAbi, functionName: "usdc" }),
  client.readContract({ address: PPW_ADDRESS, abi: ppwAbi, functionName: "videos", args: ["0x" + "00".repeat(32) as `0x${string}`] }),
]);
console.log({ local, onchain, match: local === onchain, feeBps: fee, owner, usdc, emptyVideo: video });
process.exit(local === onchain ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
