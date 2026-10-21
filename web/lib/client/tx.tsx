"use client";

import { useCallback, useState } from "react";
import type { Address, Hex } from "viem";
import { toast } from "sonner";
import { explorerTx } from "../env";
import { friendlyError } from "./errors";
import { sendTx, waitTx, type WriteFn } from "./ppw";

export type TxPhase = "idle" | "confirm" | "pending" | "success" | "error";

/**
 * Transaction runner with the standard UX:
 * "Confirm in wallet…" -> "Pending…" (explorer link) -> success / error toast.
 * `run` accepts several steps (e.g. approve then deposit) and stops at the first failure.
 */
export function useTx() {
  const [phase, setPhase] = useState<TxPhase>("idle");
  const [hash, setHash] = useState<Hex | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (from: Address | undefined, steps: { label: string; fn: WriteFn; args: unknown[]; contract?: Address }[], successMsg: string) => {
      if (!from) {
        toast.error("Connect your wallet first.");
        return false;
      }
      setError(null);
      const id = toast.loading("Confirm in wallet…");
      try {
        for (const [i, step] of steps.entries()) {
          const prefix = steps.length > 1 ? `Step ${i + 1}/${steps.length}: ${step.label}. ` : "";
          setPhase("confirm");
          toast.loading(`${prefix}Confirm in wallet…`, { id });
          const h = await sendTx(step.fn, step.args, from, step.contract);
          setHash(h);
          setPhase("pending");
          const link = explorerTx(h);
          toast.loading(`${prefix}Pending…`, {
            id,
            action: link ? { label: "View", onClick: () => window.open(link, "_blank", "noopener") } : undefined,
          });
          await waitTx(h);
        }
        setPhase("success");
        toast.success(successMsg, { id, action: undefined });
        return true;
      } catch (e) {
        const msg = friendlyError(e);
        setPhase("error");
        setError(msg);
        toast.error(msg, { id, action: undefined });
        return false;
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setPhase("idle");
    setError(null);
    setHash(null);
  }, []);

  const busy = phase === "confirm" || phase === "pending";
  const label = (idleLabel: string) => (phase === "confirm" ? "Confirm in wallet…" : phase === "pending" ? "Pending…" : idleLabel);
  return { run, phase, hash, error, busy, label, reset };
}
