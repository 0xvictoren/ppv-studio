import { defineChain } from "viem";
import { env } from "./env";

// Arc, defined from env so the same build can target testnet or mainnet.
// Arc's native gas token is USDC; the native balance uses 18 decimals while the
// USDC ERC-20 interface (what the contract uses) uses 6.
export const arc = defineChain({
  id: env.chainId,
  name: env.chainId === 5042002 ? "Arc Testnet" : "Arc",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [env.rpcUrl] } },
  blockExplorers: { default: { name: "Arcscan", url: env.explorerUrl } },
  testnet: env.chainId === 5042002,
});
