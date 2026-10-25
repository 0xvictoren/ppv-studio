/**
 * Deploy the audited PayPerWatch contract to Arc MAINNET from the owner wallet (SETTLER_PRIVATE_KEY in .env).
 * Uses Arc Studio's build in contracts/artifacts/PayPerWatch.json, checked against contracts/src first.
 *   npx tsx scripts/deploy-mainnet.ts            dry run: checks and gas estimate, sends nothing
 *   npx tsx scripts/deploy-mainnet.ts --confirm  deploys (real USDC for gas, about $0.10)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, createWalletClient, defineChain, encodeDeployData, formatUnits, getAddress, http, keccak256, type Abi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const RPC = "https://rpc.mainnet.arc.io";
const CHAIN_ID = 5042;
const USDC: Address = "0x3600000000000000000000000000000000000000";
const FEE_BPS = 500;
const confirm = process.argv.includes("--confirm");

const arc = defineChain({
  id: CHAIN_ID,
  name: "Arc",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
  blockExplorers: { default: { name: "Arcscan", url: "https://explorer.arc.io" } },
});

function envKey(name: string): Hex {
  const line = readFileSync(".env", "utf8").split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
  const v = line?.slice(name.length + 1).trim();
  if (!v) throw new Error(`${name} is not set in .env`);
  return v as Hex;
}

async function main() {
  const art = JSON.parse(readFileSync("contracts/artifacts/PayPerWatch.json", "utf8"));
  const srcHash = keccak256(readFileSync("contracts/src/PayPerWatch.sol"));
  if (srcHash !== art.sourceKeccak256) throw new Error(`contracts/src/PayPerWatch.sol doesn't match the audited build (${srcHash})`);

  const owner = privateKeyToAccount(envKey("SETTLER_PRIVATE_KEY"));
  const pub = createPublicClient({ chain: arc, transport: http(RPC) });
  const chainId = await pub.getChainId();
  if (chainId !== CHAIN_ID) throw new Error(`RPC is chain ${chainId}, expected ${CHAIN_ID}`);

  const args = [USDC, FEE_BPS, owner.address, owner.address] as const; // usdc, feeBps, feeRecipient, initialOwner
  const balance = await pub.getBalance({ address: owner.address });
  const gas = await pub.estimateGas({ account: owner.address, data: deployData(art, args) });
  const price = await pub.getGasPrice();
  console.log(`Owner and fee recipient: ${owner.address}`);
  console.log(`Balance: $${formatUnits(balance, 18)} USDC`);
  console.log(`Deploy gas: ${gas} at ${formatUnits(price, 9)} gwei ≈ $${formatUnits(gas * price, 18)}`);
  if (balance < (gas * price * 3n) / 2n) throw new Error("Not enough USDC for gas. Fund the owner wallet on Arc mainnet first.");
  if (!confirm) {
    console.log("\nDry run OK. Run again with --confirm to deploy.");
    return;
  }

  const wallet = createWalletClient({ account: owner, chain: arc, transport: http(RPC) });
  const hash = await wallet.deployContract({ abi: art.abi, bytecode: art.bytecode as Hex, args });
  console.log(`Deploy tx: https://explorer.arc.io/tx/${hash}`);
  const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error("Deploy transaction failed");
  const address = getAddress(receipt.contractAddress);

  const read = (functionName: string) => pub.readContract({ address, abi: art.abi, functionName });
  const [o, fr, u, fee, delay, paused, domain] = await Promise.all(["owner", "feeRecipient", "usdc", "feeBps", "WITHDRAW_DELAY", "paused", "eip712Domain"].map(read));
  const d = domain as readonly unknown[];
  const ok =
    getAddress(o as Address) === owner.address &&
    getAddress(fr as Address) === owner.address &&
    getAddress(u as Address) === USDC &&
    Number(fee) === FEE_BPS &&
    delay === 86_400n &&
    paused === false &&
    d[2] === "4" &&
    d[3] === BigInt(CHAIN_ID);
  console.log(`Contract: ${address} (block ${receipt.blockNumber})`);
  console.log(`Checks: ${ok ? "all OK" : "MISMATCH, don't use this contract"}`, { owner: o, feeRecipient: fr, usdc: u, fee, delay, paused, domain: d.slice(1, 4) });

  const deployments = JSON.parse(readFileSync("contracts/deployments.json", "utf8"));
  deployments.arcMainnet = {
    chainId: CHAIN_ID,
    rpc: RPC,
    explorer: "https://explorer.arc.io",
    usdc: USDC,
    PayPerWatch: {
      v4: {
        address,
        deployTx: hash,
        deployBlock: Number(receipt.blockNumber),
        eip712Version: "4",
        feeBps: FEE_BPS,
        referralBps: 500,
        withdrawDelaySeconds: 86400,
        owner: owner.address,
        sourceKeccak256: art.sourceKeccak256,
        audit: "contracts/docs/security-review-v4.md",
      },
    },
  };
  writeFileSync("contracts/deployments.json", JSON.stringify(deployments, null, 2) + "\n");
  console.log("\nSaved to contracts/deployments.json. Vercel env:");
  console.log(`NEXT_PUBLIC_PPW_CONTRACT=${address}\nNEXT_PUBLIC_PPW_DEPLOY_BLOCK=${receipt.blockNumber}`);
}

function deployData(art: { bytecode: Hex; abi: unknown[] }, args: readonly unknown[]): Hex {
  // Constructor args ABI-encoded after the creation code, as deployContract does.
  return encodeDeployData({ abi: art.abi as Abi, bytecode: art.bytecode, args: args as unknown[] });
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
