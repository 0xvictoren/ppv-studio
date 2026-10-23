/**
 * Publish the 3 Creative Commons sample films to a running PayPerWatch instance on Arc.
 *
 *   npm run seed                 # targets NEXT_PUBLIC_APP_URL (default http://localhost:3000)
 *   npm run seed -- https://ppw.example.com
 *
 * Uses SEED_CREATOR_PRIVATE_KEY as the creator: registers each video onchain (skipping ones
 * already registered), signs in with SIWE, then saves metadata through POST /api/videos, which
 * re-verifies the registration onchain. The wallet needs a little test USDC for gas.
 */
import { existsSync, readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, defineChain, encodePacked, http, keccak256, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { ppwAbi } from "../lib/abi/PayPerWatch";
import { SAMPLE_VIDEOS } from "../lib/samples";

// Minimal .env.local loader so `npm run seed` works without extra deps.
for (const file of [".env.local", ".env"]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is required`);
  return v;
};

async function main() {
  const base = (process.argv[2] ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const chainId = Number(need("NEXT_PUBLIC_ARC_CHAIN_ID"));
  const chain = defineChain({
    id: chainId,
    name: "Arc",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [need("NEXT_PUBLIC_ARC_RPC")] } },
  });
  const contract = need("NEXT_PUBLIC_PPW_CONTRACT") as Address;
  const account = privateKeyToAccount(need("SEED_CREATOR_PRIVATE_KEY") as Hex);
  const pub = createPublicClient({ chain, transport: http() });
  const wallet = createWalletClient({ account, chain, transport: http() });

  const gas = await pub.getBalance({ address: account.address });
  if (gas === 0n) throw new Error(`Creator ${account.address} has no USDC for gas. Fund it at https://faucet.circle.com (Arc Testnet).`);

  // Sign in to the app as the creator.
  const nonceRes = await fetch(`${base}/api/auth/siwe`);
  let cookie = nonceRes.headers.get("set-cookie")?.split(";")[0] ?? "";
  const { nonce } = (await nonceRes.json()) as { nonce: string };
  const message = createSiweMessage({ address: account.address, chainId, domain: new URL(base).host, nonce, uri: base, version: "1" });
  const login = await fetch(`${base}/api/auth/siwe`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ message, signature: await account.signMessage({ message }) }),
  });
  if (!login.ok) throw new Error(`Sign-in failed: ${await login.text()}`);
  cookie = login.headers.get("set-cookie")?.split(";")[0] ?? cookie;

  for (const v of SAMPLE_VIDEOS) {
    const id = keccak256(encodePacked(["address", "string"], [account.address, v.cid]));
    const existing = await fetch(`${base}/api/videos/${id}`);
    if (existing.ok) {
      console.log(`- ${v.title}: already published`);
      continue;
    }
    // Find or create the onchain registration.
    const [creator] = await pub.readContract({ address: contract, abi: ppwAbi, functionName: "videos", args: [id] });
    let tx: Hex;
    if (creator === "0x0000000000000000000000000000000000000000") {
      tx = await wallet.writeContract({ address: contract, abi: ppwAbi, functionName: "registerVideo", args: [id, v.pricePerHour] });
      await pub.waitForTransactionReceipt({ hash: tx });
      console.log(`- ${v.title}: registered onchain ${tx}`);
    } else {
      const logs = await pub.getContractEvents({ address: contract, abi: ppwAbi, eventName: "VideoRegistered", args: { videoId: id }, fromBlock: BigInt(process.env.NEXT_PUBLIC_PPW_DEPLOY_BLOCK ?? 0) });
      if (!logs[0]) throw new Error(`Couldn't find the registration of ${v.title}`);
      tx = logs[0].transactionHash;
    }
    const res = await fetch(`${base}/api/videos`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        txHash: tx,
        contentCid: v.cid,
        title: v.title,
        description: v.description,
        category: v.category,
        thumbnailUrl: v.thumbnailUrl,
        playbackUrl: v.playbackUrl,
        durationSeconds: v.durationSeconds,
      }),
    });
    console.log(`- ${v.title}: ${res.ok ? "published" : `failed: ${await res.text()}`}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
