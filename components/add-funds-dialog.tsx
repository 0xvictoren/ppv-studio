"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/primitives";
import { useAppAccount } from "@/lib/client/account";
import { useEscrow } from "@/lib/client/hooks";
import { usdcAllowance } from "@/lib/client/ppw";
import { newSessionKey, rememberSessionKey } from "@/lib/client/session-key";
import { useTx } from "@/lib/client/tx";
import { depositCap, env, isTestnet } from "@/lib/env";
import { formatUsdc, ONE_USDC, parseUsdc } from "@/lib/money";
import { cn } from "@/lib/utils";

const PRESETS = [1n, 2n, 5n, 10n].map((n) => n * ONE_USDC);

/**
 * Deposit USDC and authorize a fresh browser session key in one transaction
 * (plus an approve first if the allowance is too low).
 */
export function AddFundsDialog({
  open,
  onOpenChange,
  title = "Add funds to start watching",
  reason,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title?: string;
  reason?: string;
  onDone?: () => void;
}) {
  const { address } = useAppAccount();
  const escrow = useEscrow(address);
  const qc = useQueryClient();
  const tx = useTx();
  const [amount, setAmount] = useState<bigint>(PRESETS[1]);
  const [custom, setCustom] = useState("");

  const customAmount = custom ? parseUsdc(custom, 2) : null;
  const value = custom ? customAmount : amount;
  const wallet = escrow.data?.wallet;
  const tooMuch = value !== null && wallet !== undefined && value > wallet;
  // Soft-launch limit on what one wallet keeps in the contract. Enforced here only, not onchain.
  const room = depositCap > 0n ? depositCap - (escrow.data?.balance ?? 0n) : null;
  const overCap = room !== null && value !== null && value > room;

  async function submit() {
    if (!address || !value || value <= 0n || overCap) return;
    // The session key may spend everything that will be in escrow after this deposit.
    const cap = (escrow.data?.balance ?? 0n) + value;
    const key = newSessionKey(cap);
    const allowance = await usdcAllowance(address).catch(() => 0n);
    const steps = [
      ...(allowance < value ? [{ label: "Approve USDC", fn: "usdc.approve" as const, args: [address, value] }] : []),
      { label: "Deposit", fn: "depositAndAuthorize" as const, args: [value, key.address, BigInt(key.expiry), cap] },
    ];
    const ok = await tx.run(address, steps, `Added ${formatUsdc(value)}. Enjoy the show.`);
    if (ok) {
      rememberSessionKey(address, key);
      await qc.invalidateQueries({ queryKey: ["escrow"] });
      onOpenChange(false);
      onDone?.();
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !tx.busy && onOpenChange(o)}
      title={title}
      description={reason ?? "Your funds sit in the PayPerWatch contract. You're charged per second while a video plays, and you can withdraw the rest any time."}
    >
      <fieldset className="grid grid-cols-4 gap-2" disabled={tx.busy}>
        <legend className="sr-only">Amount</legend>
        {PRESETS.map((p) => {
          const on = !custom && amount === p;
          return (
            <button
              key={p.toString()}
              type="button"
              onClick={() => {
                setAmount(p);
                setCustom("");
              }}
              aria-pressed={on}
              className={cn(
                "h-12 rounded-md border text-[15px] font-medium tabular transition-[background-color,border-color] duration-200",
                on ? "border-primary-border bg-primary text-primary-foreground" : "hover:bg-muted",
              )}
            >
              {formatUsdc(p, { suffix: false, decimals: 0 })}
            </button>
          );
        })}
      </fieldset>
      <div className="mt-4 space-y-1.5">
        <Label htmlFor="custom-amount">Another amount</Label>
        <Input
          id="custom-amount"
          inputMode="decimal"
          placeholder="$3.50"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          disabled={tx.busy}
          aria-invalid={!!custom && !customAmount}
        />
        <p className={cn("min-h-5 text-[13px]", custom && !customAmount ? "text-destructive" : "text-muted-foreground")}>
          {custom && !customAmount
            ? "Enter a dollar amount with up to 2 decimals."
            : `In your wallet: ${wallet !== undefined ? formatUsdc(wallet) : "…"}`}
        </p>
      </div>
      {overCap && (
        <p className="mt-1 text-[13px] text-destructive">
          While we&apos;re launching, a balance can be at most {formatUsdc(depositCap)}.{" "}
          {room! > 0n ? `You can add up to ${formatUsdc(room!)}.` : "Watch some of your balance first."}
        </p>
      )}
      {tooMuch && (
        <p className="mt-1 text-[13px] text-destructive">
          Not enough USDC in your wallet.{" "}
          {isTestnet && (
            <a href={env.faucetUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
              Get free test USDC
            </a>
          )}
        </p>
      )}
      <Button className="mt-5 w-full" size="lg" disabled={!value || value <= 0n || tooMuch || overCap || tx.busy} onClick={submit}>
        {tx.label(value ? `Add ${formatUsdc(value)}` : "Add funds")}
      </Button>
      <p className="mt-4 text-center text-[13px] text-muted-foreground">One confirmation starts a 24-hour watch session with no further popups.</p>
    </Dialog>
  );
}
