import { formatUnits, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ppwAbi, PPW_ADDRESS } from "@/lib/contract";
import { isMock } from "@/lib/env";
import { publicClient } from "@/lib/server/chain";
import { lastSettlementRun } from "@/lib/server/db";
import { json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

// For an uptime monitor (UptimeRobot, cron-job.org, Better Stack...): 200 when everything is fine,
// 503 with the failing checks otherwise, so the monitor emails you.
//   HEALTH_MIN_SETTLER_USDC  settler gas balance to warn below (default 1)
//   HEALTH_MAX_SETTLE_HOURS  hours since the last good settlement run (default 26: daily cron + slack)
type Check = { ok: boolean; detail: string };

export async function GET() {
  if (isMock) return json({ ok: true, checks: {} });
  const checks: Record<string, Check> = {};
  await Promise.all([
    (async () => {
      const pk = process.env.SETTLER_PRIVATE_KEY as Hex | undefined;
      if (!pk) return void (checks.settler = { ok: false, detail: "SETTLER_PRIVATE_KEY is not set" });
      // Arc's native balance is USDC with 18 decimals.
      const balance = Number(formatUnits(await publicClient.getBalance({ address: privateKeyToAccount(pk).address }), 18));
      const min = Number(process.env.HEALTH_MIN_SETTLER_USDC ?? 1);
      checks.settler = { ok: balance >= min, detail: `settler gas balance $${balance.toFixed(2)} (warn below $${min})` };
    })().catch((e) => void (checks.settler = { ok: false, detail: msg(e) })),
    (async () => {
      const paused = await publicClient.readContract({ address: PPW_ADDRESS, abi: ppwAbi, functionName: "paused" });
      checks.contract = { ok: !paused, detail: paused ? "contract is paused" : "contract is live" };
    })().catch((e) => void (checks.contract = { ok: false, detail: msg(e) })),
    (async () => {
      const last = await lastSettlementRun();
      const at = last?.finished_at ?? last?.started_at;
      const maxH = Number(process.env.HEALTH_MAX_SETTLE_HOURS ?? 26);
      const hours = at ? (Date.now() - Date.parse(at)) / 3_600_000 : Infinity;
      checks.settlement = { ok: hours <= maxH, detail: at ? `last good run ${hours.toFixed(1)}h ago (warn after ${maxH}h)` : "no settlement run yet" };
    })().catch((e) => void (checks.settlement = { ok: false, detail: msg(e) })),
  ]);
  const ok = Object.values(checks).every((c) => c.ok);
  return json({ ok, checks }, { status: ok ? 200 : 503 });
}

function msg(e: unknown) {
  return e instanceof Error ? e.message.split("\n")[0] : String(e);
}
