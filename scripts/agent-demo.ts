/**
 * A minimal research agent that buys knowledge from PayPerWatch, the way an outside agent would:
 * search for free, pick the best match, pay for its transcript over x402 (Circle Gateway), read it.
 * Uses its own wallet (TEST_AGENT_PRIVATE_KEY), never the platform's agent account.
 *
 *   npx tsx scripts/agent-demo.ts                       # balances
 *   npx tsx scripts/agent-demo.ts new                   # print a fresh key for TEST_AGENT_PRIVATE_KEY
 *   npx tsx scripts/agent-demo.ts deposit 1             # $1: this wallet -> its Gateway balance (pays for transcripts)
 *   npx tsx scripts/agent-demo.ts ask "fibonacci retracement"
 *
 * PPW_URL picks the site (default NEXT_PUBLIC_APP_URL).
 */
import { GatewayClient, type SupportedChainName } from "@circle-fin/x402-batching/client";
import { existsSync, readFileSync } from "node:fs";
import type { Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

for (const file of [".env.local", ".env"]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

type SearchResult = {
  id: string;
  title: string;
  relevance: number;
  moments: { start: number; end: number; text: string }[];
  transcript: { url: string; price: string } | null;
};
type Transcript = {
  video: { title: string; watchUrl: string };
  transcript: string;
  segments: { start: number; end: number; text: string }[];
  payment: { amount: string; network: string; transaction: string | null };
};

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === "new") {
    const pk = generatePrivateKey();
    console.log(`TEST_AGENT_PRIVATE_KEY=${pk}\naddress: ${privateKeyToAccount(pk).address}`);
    return;
  }
  const pk = process.env.TEST_AGENT_PRIVATE_KEY as Hex | undefined;
  if (!pk) throw new Error("Set TEST_AGENT_PRIVATE_KEY (create one with: npx tsx scripts/agent-demo.ts new)");
  const isTestnet = process.env.NEXT_PUBLIC_ARC_CHAIN_ID === "5042002";
  const chain: SupportedChainName = isTestnet ? "arcTestnet" : "arc";
  const gateway = new GatewayClient({ chain, privateKey: pk, rpcUrl: process.env.NEXT_PUBLIC_ARC_RPC });
  const site = (process.env.PPW_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");

  if (cmd === "deposit") {
    if (!arg) throw new Error("Pass an amount in USDC, e.g. deposit 1");
    const r = await gateway.deposit(arg);
    console.log(`deposited ${r.formattedAmount} USDC into Gateway  tx ${r.depositTxHash}`);
  } else if (cmd === "ask") {
    if (!arg) throw new Error('Pass a question, e.g. ask "fibonacci retracement"');
    console.log(`agent ${gateway.address} researching "${arg}" on ${site}\n`);

    const res = await fetch(`${site}/api/agent/search?q=${encodeURIComponent(arg)}&limit=5`);
    if (!res.ok) throw new Error(`search failed: ${res.status} ${await res.text()}`);
    const { results } = (await res.json()) as { results: SearchResult[] };
    for (const r of results) console.log(`  ${r.relevance.toFixed(2).padStart(6)}  ${r.title}  ${r.transcript ? r.transcript.price : "(no transcript yet)"}`);
    const pick = results.find((r) => r.transcript);
    if (!pick) return console.log("\nnothing for sale on this topic yet");

    console.log(`\nbuying the transcript of "${pick.title}" for ${pick.transcript!.price} ...`);
    const paid = await gateway.pay<Transcript>(pick.transcript!.url);
    const t = paid.data;
    console.log(`paid ${paid.formattedAmount} USDC on ${t.payment.network}  settlement ${paid.transaction || "(batched)"}`);
    console.log(`got ${t.segments.length} timestamped segments, ${t.transcript.length} characters\n`);
    for (const s of t.segments.slice(0, 8)) console.log(`  [${clock(s.start)}] ${s.text}`);
    if (t.segments.length > 8) console.log(`  ... ${t.segments.length - 8} more`);
    console.log(`\nsource: ${t.video.watchUrl}`);
  }

  const b = await gateway.getBalances();
  console.log(`\ntest agent      ${gateway.address}`);
  console.log(`Gateway         ${b.gateway.formattedAvailable} USDC available (spent on transcripts)`);
  console.log(`wallet on Arc   ${b.wallet.formatted} USDC`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
