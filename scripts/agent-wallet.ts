/**
 * The platform's agent account (AGENT_PRIVATE_KEY): agents pay it through Circle Gateway, and it
 * pays creators through PayPerWatch receipts. Keep its PayPerWatch balance topped up.
 *
 *   npx tsx scripts/agent-wallet.ts               # balances
 *   npx tsx scripts/agent-wallet.ts new           # print a fresh key for AGENT_PRIVATE_KEY
 *   npx tsx scripts/agent-wallet.ts withdraw 5    # $5 of agent earnings: Gateway -> this wallet on Arc
 *   npx tsx scripts/agent-wallet.ts deposit 5     # $5: this wallet -> PayPerWatch balance (pays creators)
 */
import { GatewayClient, type SupportedChainName } from "@circle-fin/x402-batching/client";
import { existsSync, readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { arc } from "../lib/chain";
import { erc20Abi, ppwAbi, PPW_ADDRESS, USDC_ADDRESS } from "../lib/contract";
import { env, isTestnet } from "../lib/env";
import { formatUsdc, parseUsdc } from "../lib/money";

for (const file of [".env.local", ".env"]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const GATEWAY_CHAIN: SupportedChainName = isTestnet ? "arcTestnet" : "arc";

async function main() {
  const [cmd, amountArg] = process.argv.slice(2);
  if (cmd === "new") {
    const pk = generatePrivateKey();
    console.log(`AGENT_PRIVATE_KEY=${pk}\naddress: ${privateKeyToAccount(pk).address}`);
    return;
  }
  const pk = process.env.AGENT_PRIVATE_KEY as Hex | undefined;
  if (!pk) throw new Error("Set AGENT_PRIVATE_KEY (create one with: npx tsx scripts/agent-wallet.ts new)");
  const account = privateKeyToAccount(pk);
  const pub = createPublicClient({ chain: arc, transport: http() });
  const wallet = createWalletClient({ account, chain: arc, transport: http() });
  const gateway = new GatewayClient({ chain: GATEWAY_CHAIN, privateKey: pk, rpcUrl: env.rpcUrl });

  if (cmd === "withdraw" || cmd === "deposit") {
    const amount = parseUsdc(amountArg ?? "");
    if (!amount) throw new Error(`Pass an amount in USDC, e.g. ${cmd} 5`);
    if (cmd === "withdraw") {
      const r = await gateway.withdraw(amountArg!, { chain: GATEWAY_CHAIN });
      console.log("withdrawn from Gateway:", r);
    } else {
      const approve = await wallet.writeContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: "approve", args: [PPW_ADDRESS, amount] });
      await pub.waitForTransactionReceipt({ hash: approve });
      const hash = await wallet.writeContract({ address: PPW_ADDRESS, abi: ppwAbi, functionName: "deposit", args: [amount] });
      await pub.waitForTransactionReceipt({ hash });
      console.log(`deposited ${formatUsdc(amount)} into PayPerWatch  tx ${hash}`);
    }
  }

  const [balances, ppwBalance] = await Promise.all([
    gateway.getBalances(),
    pub.readContract({ address: PPW_ADDRESS, abi: ppwAbi, functionName: "balanceOf", args: [account.address] }),
  ]);
  console.log(`agent account   ${account.address}`);
  console.log(`Gateway         ${balances.gateway.formattedAvailable} USDC available (agent payments land here)`);
  console.log(`wallet on Arc   ${balances.wallet.formatted} USDC`);
  console.log(`PayPerWatch     ${formatUsdc(ppwBalance as bigint)} (pays creators at settlement)`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
