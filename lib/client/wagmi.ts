"use client";

import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import {
  coinbaseWallet,
  injectedWallet,
  metaMaskWallet,
  rabbyWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { arc } from "../chain";
import { env } from "../env";

const projectId = env.walletConnectProjectId;

const connectors = connectorsForWallets(
  [
    {
      groupName: "Wallets",
      // WalletConnect-based wallets only when a project id is configured.
      wallets: projectId
        ? [metaMaskWallet, rabbyWallet, coinbaseWallet, walletConnectWallet, injectedWallet]
        : [injectedWallet, rabbyWallet, coinbaseWallet],
    },
  ],
  { appName: "PayPerWatch", projectId: projectId || "unset" },
);

export const wagmiConfig = createConfig({
  chains: [arc],
  connectors,
  transports: { [arc.id]: http(env.rpcUrl) },
  ssr: true,
});
