import { lastSettlementRun } from "@/lib/server/db";
import { json } from "@/lib/server/http";
import { nextRunAt } from "@/lib/server/settle";

export const dynamic = "force-dynamic";

export async function GET() {
  const last = await lastSettlementRun();
  return json({
    lastRunAt: last?.finished_at ?? last?.started_at ?? null,
    lastStatus: last?.status ?? null,
    lastTxHash: last?.tx_hash?.split(",")[0] ?? null,
    nextRunAt: nextRunAt().toISOString(),
  });
}
