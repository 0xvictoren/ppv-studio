import type { Address } from "viem";

// Public (client + server) configuration. Everything chain-specific comes from env vars.
// Defaults target the live PayPerWatch deployment on Arc Testnet.
export const env = {
  chainId: Number(process.env.NEXT_PUBLIC_ARC_CHAIN_ID ?? 5042002),
  rpcUrl: process.env.NEXT_PUBLIC_ARC_RPC ?? "https://rpc.testnet.arc.io",
  explorerUrl: (process.env.NEXT_PUBLIC_ARC_EXPLORER ?? "https://explorer.testnet.arc.io").replace(/\/$/, ""),
  usdcAddress: (process.env.NEXT_PUBLIC_USDC_ADDRESS ?? "0x3600000000000000000000000000000000000000") as Address,
  ppwAddress: (process.env.NEXT_PUBLIC_PPW_CONTRACT ?? "0x9da4403e212804081cd0d5bab0ea9d0bcc3d96e1") as Address,
  // Block the contract was deployed at; event scans start here.
  deployBlock: BigInt(process.env.NEXT_PUBLIC_PPW_DEPLOY_BLOCK ?? 68679534),
  // Simulated chain for automated tests only. Off by default: the app runs on Arc Testnet.
  mockMode: process.env.NEXT_PUBLIC_MOCK_MODE === "true",
  walletConnectProjectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "",
  storageProvider: (process.env.NEXT_PUBLIC_STORAGE_PROVIDER ?? "local") as "local" | "r2" | "supabase" | "livepeer" | "pinata" | "mock",
  appUrl: (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  faucetUrl: "https://faucet.circle.com",
  /** Earlier PayPerWatch deployments, so viewers can withdraw any balance left there. */
  legacyContracts: (process.env.NEXT_PUBLIC_PPW_LEGACY_CONTRACTS ?? "0xfff200a3921d18ae09616901a1aaf9434ce693e7,0xdde5bd885455291429ae262a06d1aabaddf1c89b,0x5ce5d5b34a09a0406b4b9c2e9da7ffafb006d51d")
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean) as Address[],
};

export const isMock = env.mockMode;
export const isTestnet = env.chainId === 5042002;

export function explorerTx(hash: string) {
  if (isMock) return null;
  return `${env.explorerUrl}/tx/${hash}`;
}

export function explorerAddress(address: string) {
  if (isMock) return null;
  return `${env.explorerUrl}/address/${address}`;
}
