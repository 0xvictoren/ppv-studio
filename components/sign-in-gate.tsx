"use client";

import type { ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAppAccount } from "@/lib/client/account";
import { friendlyError } from "@/lib/client/errors";

/** Renders children only for a connected wallet that has signed in with SIWE. */
export function SignInGate({ children, purpose, embedded }: { children: ReactNode; purpose: string; embedded?: boolean }) {
  const acct = useAppAccount();
  if (acct.isConnected && acct.signedInAs) return <>{children}</>;
  return (
    <div className="mx-auto max-w-md rounded-xl border bg-surface px-8 py-12 text-center">
      <h2 className="font-display text-[22px] font-semibold">{acct.isConnected ? "Sign in with your wallet" : "Connect your wallet"}</h2>
      <p className="mt-2 text-[15px] text-muted-foreground">Your wallet is your account. There&apos;s no email or password. {purpose}</p>
      <div className="mt-8 flex flex-col items-center gap-3">
        {acct.isConnected ? (
          <Button size="lg" disabled={acct.signingIn} onClick={() => acct.signIn().catch((e) => toast.error(friendlyError(e)))}>
            {acct.signingIn ? "Check your wallet…" : "Sign in"}
          </Button>
        ) : (
          <Button size="lg" onClick={acct.connect}>
            Connect wallet
          </Button>
        )}
        <p className="text-[13px] text-muted-foreground">Signing in is free and doesn&apos;t send a transaction.</p>
        {embedded && (
          <a className="text-[13px] text-secondary underline-offset-4 hover:underline" href={typeof window !== "undefined" ? window.location.href : "#"} target="_blank" rel="noopener">
            Trouble signing in here? Open in a new tab
          </a>
        )}
      </div>
    </div>
  );
}
