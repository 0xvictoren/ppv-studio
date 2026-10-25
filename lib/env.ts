import type { Address } from "viem";
import deployments from "../contracts/deployments.json";

// Filled in by scripts/deploy-mainnet.ts.
const mainnet = (deployments as { arcMainnet?: { PayPerWatch: { v4: { address: string; deployBlock: number } } } }).arcMainnet?.PayPerWatch.v4;

// Public (client + server) configuration. Everything chain-specific comes from env vars.
// Defaults target the live PayPerWatch deployment on Arc mainnet (the testnet branch keeps the testnet ones).
export const env = {
  chainId: Number(process.env.NEXT_PUBLIC_ARC_CHAIN_ID ?? 5042),
  rpcUrl: process.env.NEXT_PUBLIC_ARC_RPC ?? "https://rpc.mainnet.arc.io",
  explorerUrl: (process.env.NEXT_PUBLIC_ARC_EXPLORER ?? "https://explorer.arc.io").replace(/\/$/, ""),
  usdcAddress: (process.env.NEXT_PUBLIC_USDC_ADDRESS ?? "0x3600000000000000000000000000000000000000") as Address,
  ppwAddress: (process.env.NEXT_PUBLIC_PPW_CONTRACT ?? mainnet?.address ?? "0x0000000000000000000000000000000000000000") as Address,
  // Block the contract was deployed at; event scans start here.
  deployBlock: BigInt(process.env.NEXT_PUBLIC_PPW_DEPLOY_BLOCK ?? mainnet?.deployBlock ?? 0),
  // Simulated chain for automated tests only. Off by default.
  mockMode: process.env.NEXT_PUBLIC_MOCK_MODE === "true",
  walletConnectProjectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "",
  storageProvider: (process.env.NEXT_PUBLIC_STORAGE_PROVIDER ?? "local") as "local" | "r2" | "supabase" | "livepeer" | "pinata" | "mock",
  appUrl: (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  faucetUrl: "https://faucet.circle.com",
  /** Earlier PayPerWatch deployments, so viewers can withdraw any balance left there. */
  legacyContracts: (process.env.NEXT_PUBLIC_PPW_LEGACY_CONTRACTS ?? "")
    .split(",")
    .map((a) => a.trim())
    .filter((a) => /^0x[0-9a-fA-F]{40}$/.test(a)) as Address[], // "none" = no earlier deployments
};

export const isMock = env.mockMode;
export const isTestnet = env.chainId === 5042002;

/** Off unless the variable is "on"/"off"; unset falls back to the network default. */
function flag(v: string | undefined, fallback: boolean) {
  return v === "on" ? true : v === "off" ? false : fallback;
}

/**
 * Paid transcripts for AI agents (Circle Gateway nanopayments). Gateway doesn't support
 * nanopayments on Arc mainnet yet, and transcripts come from the review worker, so this
 * defaults to testnet only. NEXT_PUBLIC_AGENT_API=on|off overrides.
 */
export const agentApiEnabled = flag(process.env.NEXT_PUBLIC_AGENT_API, isTestnet);

/** Most a wallet can hold in PayPerWatch while we soft-launch, in USDC (6 decimals). 0 = no cap; $50 by default on mainnet. */
export const depositCap = BigInt(Math.round(Number(process.env.NEXT_PUBLIC_DEPOSIT_CAP_USDC ?? (isTestnet ? 0 : 50)) * 1e6) || 0);

export function explorerTx(hash: string) {
  if (isMock) return null;
  return `${env.explorerUrl}/tx/${hash}`;
}

export function explorerAddress(address: string) {
  if (isMock) return null;
  return `${env.explorerUrl}/address/${address}`;
}
