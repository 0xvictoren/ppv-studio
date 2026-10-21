"use client";

import { ChevronDownIcon, ExitIcon, ExternalLinkIcon } from "@radix-ui/react-icons";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAppAccount } from "@/lib/client/account";
import { friendlyError } from "@/lib/client/errors";
import { useEscrow } from "@/lib/client/hooks";
import { env, explorerAddress, isTestnet } from "@/lib/env";
import { formatUsdc, shortAddress } from "@/lib/money";
import { cn } from "@/lib/utils";

export function ConnectButton({ compact }: { compact?: boolean }) {
  const acct = useAppAccount();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const escrow = useEscrow(acct.address);

  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, []);

  if (!acct.isConnected) {
    if (acct.demo) {
      // Automated-test builds only (NEXT_PUBLIC_MOCK_MODE=true).
      return (
        <Button size="sm" onClick={() => acct.demo!.select(0)}>
          Connect test wallet
        </Button>
      );
    }
    return (
      <Button size="sm" onClick={acct.connect}>
        Connect wallet
      </Button>
    );
  }

  const link = acct.address ? explorerAddress(acct.address) : null;
  return (
    <div className="relative" ref={ref}>
      <Button variant="outline" size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu" className="gap-1.5 pl-3">
        <span className="tabular">{compact ? shortAddress(acct.address) : escrow.data ? formatUsdc(escrow.data.available, { suffix: false }) : shortAddress(acct.address)}</span>
        <ChevronDownIcon className={cn("transition-transform duration-200", open && "rotate-180")} />
      </Button>
      <div
        role="menu"
        className={cn(
          "absolute right-0 z-40 mt-2 w-72 origin-top-right rounded-lg border bg-surface p-2 shadow-[0_12px_40px_rgba(0,0,0,0.10)] transition-[opacity,transform,visibility] duration-200 ease-apple",
          open ? "visible scale-100 opacity-100" : "invisible pointer-events-none scale-[0.97] opacity-0",
        )}
      >
        <div className="px-3 py-2">
          <p className="text-xs text-muted-foreground">{isTestnet ? "Arc Testnet" : "Arc"}</p>
          <p className="mt-0.5 font-mono text-[13px]">{shortAddress(acct.address)}</p>
          {escrow.data && (
            <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Available to watch</dt>
                <dd className="tabular">{formatUsdc(escrow.data.available)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">In wallet</dt>
                <dd className="tabular">{formatUsdc(escrow.data.wallet)}</dd>
              </div>
            </dl>
          )}
        </div>
        <div className="my-1 h-px bg-border" />
        {!acct.signedInAs && (
          <MenuItem onClick={() => acct.signIn().catch((e) => toast.error(friendlyError(e)))} disabled={acct.signingIn}>
            {acct.signingIn ? "Check your wallet…" : "Sign in (needed to upload)"}
          </MenuItem>
        )}
        {isTestnet && (
          <MenuItem href={env.faucetUrl}>
            Get test USDC <ExternalLinkIcon className="ml-auto" />
          </MenuItem>
        )}
        {link && (
          <MenuItem href={link}>
            View on explorer <ExternalLinkIcon className="ml-auto" />
          </MenuItem>
        )}
        <MenuItem
          onClick={() => {
            acct.disconnect();
            setOpen(false);
          }}
        >
          Disconnect <ExitIcon className="ml-auto" />
        </MenuItem>
      </div>
    </div>
  );
}

function MenuItem({ children, onClick, href, disabled }: { children: React.ReactNode; onClick?: () => void; href?: string; disabled?: boolean }) {
  const cls = "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors duration-150 hover:bg-muted disabled:opacity-50";
  if (href) {
    return (
      <a role="menuitem" href={href} target="_blank" rel="noopener noreferrer" className={cls}>
        {children}
      </a>
    );
  }
  return (
    <button role="menuitem" className={cls} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}
