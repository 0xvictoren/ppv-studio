"use client";

import { useConnectModal } from "@rainbow-me/rainbowkit";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { useAccount, useDisconnect, useSignMessage } from "wagmi";
import { env } from "../env";
import { DEMO_ACCOUNTS } from "../samples";
import { api } from "./api";

// One account abstraction for the app. In mock mode the "wallet" is one of the public demo
// keys; otherwise it's whatever the user connects through RainbowKit. Either way the wallet
// is the account and SIWE gives us a server session.

type AccountCtx = {
  address?: Address;
  isConnected: boolean;
  /** Mock mode only: the demo accounts and the current one. */
  demo?: { accounts: { label: string; address: Address }[]; select: (i: number) => void; current: number };
  connect: () => void;
  disconnect: () => void;
  signMessage: (message: string) => Promise<Hex>;
  /** SIWE */
  signedInAs: string | null;
  signIn: () => Promise<boolean>;
  signOut: () => Promise<void>;
  signingIn: boolean;
};

const Ctx = createContext<AccountCtx | null>(null);

export function useAppAccount() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAppAccount must be used inside AccountProvider");
  return v;
}

function useSiwe(address: Address | undefined, signMessage: (m: string) => Promise<Hex>) {
  const [signedInAs, setSignedInAs] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    api<{ address: string | null }>("/api/auth/me")
      .then((r) => setSignedInAs(r.address))
      .catch(() => {});
  }, []);

  // A session for a different wallet doesn't count.
  const effective = signedInAs && address && signedInAs === address.toLowerCase() ? signedInAs : null;

  const signIn = useCallback(async () => {
    if (!address) return false;
    setSigningIn(true);
    try {
      const { nonce } = await api<{ nonce: string }>("/api/auth/siwe");
      const message = createSiweMessage({
        address,
        chainId: env.chainId,
        domain: window.location.host,
        nonce,
        uri: window.location.origin,
        version: "1",
        statement: "Sign in to PayPerWatch. This doesn't cost anything or move funds.",
        issuedAt: new Date(),
        expirationTime: new Date(Date.now() + 24 * 3600 * 1000),
      });
      const signature = await signMessage(message);
      const r = await api<{ address: string }>("/api/auth/siwe", { method: "POST", json: { message, signature } });
      setSignedInAs(r.address);
      return true;
    } finally {
      setSigningIn(false);
    }
  }, [address, signMessage]);

  const signOut = useCallback(async () => {
    await api("/api/auth/siwe", { method: "DELETE" });
    setSignedInAs(null);
  }, []);

  return { signedInAs: effective, signIn, signOut, signingIn };
}

// ------------------------------------------------------------------ mock

const DEMO_KEY = "ppw:demo-account";

export function MockAccountProvider({ children }: { children: ReactNode }) {
  const accounts = useMemo(() => DEMO_ACCOUNTS.map((a) => ({ ...a, account: privateKeyToAccount(a.privateKey) })), []);
  const [current, setCurrent] = useState<number>(-1);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(DEMO_KEY);
      if (saved !== null) setCurrent(Number(saved));
    } catch {
      /* storage unavailable */
    }
  }, []);

  const select = useCallback((i: number) => {
    setCurrent(i);
    try {
      localStorage.setItem(DEMO_KEY, String(i));
    } catch {
      /* ignore */
    }
  }, []);

  const acct = current >= 0 ? accounts[current]?.account : undefined;
  const signMessage = useCallback(
    async (message: string) => {
      if (!acct) throw new Error("Connect a wallet first");
      return acct.signMessage({ message });
    },
    [acct],
  );
  const siwe = useSiwe(acct?.address, signMessage);

  const value: AccountCtx = {
    address: acct?.address,
    isConnected: !!acct,
    demo: { accounts: accounts.map((a) => ({ label: a.label, address: a.account.address })), select, current },
    connect: () => select(0),
    disconnect: () => {
      select(-1);
      siwe.signOut().catch(() => {});
    },
    signMessage,
    ...siwe,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// ------------------------------------------------------------------ real wallets

export function WalletAccountProvider({ children }: { children: ReactNode }) {
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const signMessage = useCallback((message: string) => signMessageAsync({ message }), [signMessageAsync]);
  const siwe = useSiwe(address, signMessage);

  const value: AccountCtx = {
    address,
    isConnected,
    connect: () => openConnectModal?.(),
    disconnect: () => {
      disconnect();
      siwe.signOut().catch(() => {});
    },
    signMessage,
    ...siwe,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
