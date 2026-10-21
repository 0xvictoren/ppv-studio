import { listWatchSessions } from "@/lib/server/db";
import { getEvents } from "@/lib/server/events";
import { json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Public platform stats for the landing page. USDC figures come from contract events. */
export async function GET() {
  const [settled, deposits, sessions] = await Promise.all([
    getEvents({ name: ["Settled"] }).catch(() => []),
    getEvents({ name: ["Deposited"] }).catch(() => []),
    listWatchSessions().catch(() => []),
  ]);
  const totalSettled = settled.reduce((a, e) => a + BigInt(String(e.args.delta)), 0n);
  const totalDeposited = deposits.reduce((a, e) => a + BigInt(String(e.args.amount)), 0n);
  const totalReferral = settled.reduce((a, e) => a + BigInt(String(e.args.referralAmount ?? "0")), 0n);
  const creatorsPaid = new Set(settled.map((e) => String(e.args.creator).toLowerCase())).size;
  const viewers = new Set(deposits.map((e) => String(e.args.viewer).toLowerCase())).size;
  const secondsWatched = sessions.reduce((a, s) => a + s.seconds, 0);
  return json({
    totalSettled: totalSettled.toString(),
    totalDeposited: totalDeposited.toString(),
    totalReferral: totalReferral.toString(),
    creatorsPaid,
    viewers,
    minutesWatched: Math.round(secondsWatched / 60),
    settlementTxs: new Set(settled.map((e) => e.txHash)).size,
  });
}
