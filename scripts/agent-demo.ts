/**
 * A minimal research agent that buys knowledge from PayPerWatch, the way an outside agent would:
 * search for free, pick the best match, pay for its transcript over x402 (Circle Gateway), read it.
 * Uses its own wallet (TEST_AGENT_PRIVATE_KEY), never the platform's agent account.
 *
 *   npx tsx scripts/agent-demo.ts                       # balances
 *   npx tsx scripts/agent-demo.ts new                   # print a fresh key for TEST_AGENT_PRIVATE_KEY
 *   npx tsx scripts/agent-demo.ts deposit 1             # $1: this wallet -> its Gateway balance (pays for transcripts)
 *   npx tsx scripts/agent-demo.ts ask "how does private credit work onchain"   # one call to /api/agent/ask
 *
 * PPW_URL picks the site (default NEXT_PUBLIC_APP_URL). Add --mainnet to use Arc mainnet and the live
 * site whatever .env says (real USDC).
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

type Segment = { start: number; end: number; text: string };
type Answer = {
  answer: { video: { title: string; watchUrl: string }; moments: Segment[]; transcript: string; segments: Segment[] };
  alsoRelevant: { title: string; transcript: { url: string; price: string } }[];
  payment: { amount: string; network: string; transaction: string | null };
};

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

async function main() {
  const mainnet = process.argv.includes("--mainnet");
  if (mainnet) {
    process.env.NEXT_PUBLIC_ARC_CHAIN_ID = "5042";
    process.env.NEXT_PUBLIC_ARC_RPC = "https://rpc.mainnet.arc.io";
    process.env.PPW_URL ||= "https://ppv-studio.vercel.app";
  }
  const chainArg = process.argv.find((a) => a.startsWith("--chain="))?.slice("--chain=".length);
  const [cmd, arg] = process.argv.slice(2).filter((a) => a !== "--mainnet" && !a.startsWith("--chain="));
  if (cmd === "new") {
    const pk = generatePrivateKey();
    console.log(`TEST_AGENT_PRIVATE_KEY=${pk}\naddress: ${privateKeyToAccount(pk).address}`);
    return;
  }
  const pk = process.env.TEST_AGENT_PRIVATE_KEY as Hex | undefined;
  if (!pk) throw new Error("Set TEST_AGENT_PRIVATE_KEY (create one with: npx tsx scripts/agent-demo.ts new)");
  const isTestnet = process.env.NEXT_PUBLIC_ARC_CHAIN_ID === "5042002";
  // --chain=base etc.: pay from a Gateway balance on another chain the 402 accepts.
  const chain = (chainArg ?? (isTestnet ? "arcTestnet" : "arc")) as SupportedChainName;
  const gateway = new GatewayClient({ chain, privateKey: pk, rpcUrl: process.env.NEXT_PUBLIC_ARC_RPC });
  const site = (process.env.PPW_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");

  if (cmd === "deposit") {
    if (!arg) throw new Error("Pass an amount in USDC, e.g. deposit 1");
    const r = await gateway.deposit(arg);
    console.log(`deposited ${r.formattedAmount} USDC into Gateway  tx ${r.depositTxHash}`);
  } else if (cmd === "ask") {
    if (!arg) throw new Error('Pass a question, e.g. ask "how does private credit work onchain"');
    // The one-link flow an outside agent uses: ask, get a 402 with the price, pay, read the answer.
    console.log(`agent ${gateway.address} asking ${site}/api/agent/ask: "${arg}"
`);
    const url = `${site}/api/agent/ask?q=${encodeURIComponent(arg)}`;
    const probe = await fetch(url);
    if (probe.status === 404) return console.log("nothing on PayPerWatch covers this yet (not charged)");
    if (probe.status !== 402) throw new Error(`ask failed: ${probe.status} ${await probe.text()}`);
    const paid = await gateway.pay<Answer>(url);
    const { answer, alsoRelevant, payment } = paid.data;
    console.log(`paid ${paid.formattedAmount} USDC on ${payment.network}  settlement ${paid.transaction || "(batched)"}`);
    console.log(`answer from "${answer.video.title}" (${answer.segments.length} segments)
`);
    for (const m of answer.moments) console.log(`  [${clock(m.start)}] ${m.text}`);
    console.log(`
source: ${answer.video.watchUrl}`);
    for (const r of alsoRelevant) console.log(`also relevant: ${r.title}  ${r.transcript.price}`);
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
