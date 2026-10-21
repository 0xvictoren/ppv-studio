"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client/api";
import { isMock } from "@/lib/env";
import { formatUsdc } from "@/lib/money";

/** Mock mode only: trigger the hourly settlement job now, for demos. */
export function SettleNowButton() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  if (!isMock) return null;
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const r = await api<{ status: string; count: number; total: string }>("/api/cron/settle", { method: "POST" });
          toast.success(r.count ? `Settled ${r.count} receipt(s), ${formatUsdc(BigInt(r.total))}.` : "Nothing to settle.");
          await qc.invalidateQueries();
        } catch (e) {
          toast.error((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "Settling…" : "Run hourly settlement now (demo)"}
    </Button>
  );
}
