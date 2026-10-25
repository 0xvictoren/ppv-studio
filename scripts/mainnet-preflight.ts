/**
 * Read-only checks before (and right after) pointing a site at Arc mainnet. Sends no transactions.
 *   npx tsx scripts/mainnet-preflight.ts .env [https://ppv-studio.vercel.app]
 * The env file holds the site's variables with the mainnet values from MAINNET.md. With a site URL it
 * also checks the live deployment.
 */
import { readFileSync } from "node:fs";
import { createPublicClient, erc20Abi, formatUnits, getAddress, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const [file = ".env", site] = process.argv.slice(2);
for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
}

let failures = 0;
const check = (name: string, ok: boolean, extra?: unknown) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== undefined ? `  ${String(extra)}` : ""}`);
  if (!ok) failures++;
};
const warn = (name: string, extra?: unknown) => console.log(`WARN  ${name}${extra !== undefined ? `  ${String(extra)}` : ""}`);

async function main() {
  const e = process.env;
  const { ppwAbi } = await import("../lib/abi/PayPerWatch");

  // Config
  check("chain id is Arc mainnet (5042)", e.NEXT_PUBLIC_ARC_CHAIN_ID === "5042", e.NEXT_PUBLIC_ARC_CHAIN_ID);
  check("not mock mode", e.NEXT_PUBLIC_MOCK_MODE !== "true");
  check("app URL is https", /^https:\/\//.test(e.NEXT_PUBLIC_APP_URL ?? ""), e.NEXT_PUBLIC_APP_URL);
  check("legacy contracts set explicitly (none on mainnet)", e.NEXT_PUBLIC_PPW_LEGACY_CONTRACTS !== undefined, e.NEXT_PUBLIC_PPW_LEGACY_CONTRACTS);
  check("review worker muted (CONTENT_REVIEW unset or off)", e.CONTENT_REVIEW !== "on", e.CONTENT_REVIEW ?? "unset");
  check("agent API off (unset or off)", e.NEXT_PUBLIC_AGENT_API !== "on", e.NEXT_PUBLIC_AGENT_API ?? "unset");
  if (!/@/.test(e.NEXT_PUBLIC_CONTACT_EMAIL ?? "")) warn("NEXT_PUBLIC_CONTACT_EMAIL not set: the pages use the built-in default");
  check("database set", !!e.MONGODB_URI, e.MONGODB_DB);
  check("R2 bucket set", e.NEXT_PUBLIC_STORAGE_PROVIDER === "r2" && !!e.R2_BUCKET, e.R2_BUCKET);
  for (const k of ["SESSION_SECRET", "CRON_SECRET"]) check(`${k} is 32+ chars`, (e[k] ?? "").length >= 32);
  if (e.NEXT_PUBLIC_DEPOSIT_CAP_USDC === "0") warn("soft-launch deposit cap turned off (NEXT_PUBLIC_DEPOSIT_CAP_USDC=0)");

  // Chain
  const rpc = e.NEXT_PUBLIC_ARC_RPC!;
  const client = createPublicClient({ transport: http(rpc) });
  check("RPC answers with chain 5042", (await client.getChainId()) === 5042, rpc);
  const usdc = getAddress(e.NEXT_PUBLIC_USDC_ADDRESS!);
  const [decimals, symbol] = await Promise.all([
    client.readContract({ address: usdc, abi: erc20Abi, functionName: "decimals" }),
    client.readContract({ address: usdc, abi: erc20Abi, functionName: "symbol" }),
  ]);
  check("USDC is 6-decimal USDC", decimals === 6 && symbol === "USDC", `${symbol} ${decimals}`);

  const settlerPk = e.SETTLER_PRIVATE_KEY as Hex | undefined;
  const settler = settlerPk ? privateKeyToAccount(settlerPk).address : undefined;
  check("settler key set", !!settler, settler);
  if (settler) {
    const gas = Number(formatUnits(await client.getBalance({ address: settler }), 18));
    check("settler has gas money (>= $2)", gas >= 2, `$${gas.toFixed(2)}`);
  }

  const ppw = e.NEXT_PUBLIC_PPW_CONTRACT as Address | undefined;
  if (!ppw) {
    warn("NEXT_PUBLIC_PPW_CONTRACT not set yet: contract checks skipped (deploy first)");
  } else {
    const read = <T,>(functionName: string) => client.readContract({ address: ppw, abi: ppwAbi, functionName: functionName as never }) as Promise<T>;
    check("contract has code", ((await client.getCode({ address: ppw })) ?? "0x").length > 2, ppw);
    const [owner, feeRecipient, token, feeBps, delay, paused, domain] = await Promise.all([
      read<Address>("owner"),
      read<Address>("feeRecipient"),
      read<Address>("usdc"),
      read<number>("feeBps"),
      read<bigint>("WITHDRAW_DELAY"),
      read<boolean>("paused"),
      read<readonly [Hex, string, string, bigint, Address]>("eip712Domain"),
    ]);
    check("contract uses mainnet USDC", getAddress(token) === usdc, token);
    // Separate keys are safer, but the operator may choose one wallet for everything: warn, don't fail.
    if (settler && getAddress(owner) === getAddress(settler)) warn("owner is the settler hot key: a server leak gives contract control", owner);
    if (settler && getAddress(feeRecipient) === getAddress(settler)) warn("fee recipient is the settler hot key", feeRecipient);
    const ownerCode = (await client.getCode({ address: owner })) ?? "0x";
    if (ownerCode.length <= 2) warn("owner is a plain wallet, not a multisig. Fine if it's a hardware wallet", owner);
    check("platform fee 5%", Number(feeBps) === 500, feeBps);
    check("withdraw delay 24h", delay === 86_400n, delay);
    check("not paused", !paused);
    check("EIP-712 domain is PayPerWatch v4 on chain 5042", domain[2] === "4" && domain[3] === 5042n && getAddress(domain[4]) === getAddress(ppw), `${domain[1]} v${domain[2]} chain ${domain[3]}`);
    const block = BigInt(e.NEXT_PUBLIC_PPW_DEPLOY_BLOCK || 0);
    check("deploy block set", block > 0n, block);
  }

  // Live site
  if (site) {
    const base = site.replace(/\/$/, "");
    for (const p of ["/", "/terms", "/privacy", "/manual"]) check(`GET ${p}`, (await fetch(base + p)).status === 200);
    check("agent API is off", (await fetch(`${base}/api/agent/search?q=test`)).status === 404);
    check("mock chain endpoint disabled", (await fetch(`${base}/api/mock/contract`, { method: "POST", body: "{}" })).status === 404);
    const home = await (await fetch(base + "/")).text();
    check("home page doesn't say testnet", !/Arc Testnet|test USDC/i.test(home));
    const health = await fetch(`${base}/api/health`);
    check("health check passes", health.status === 200, JSON.stringify(await health.json()));
  }

  console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
