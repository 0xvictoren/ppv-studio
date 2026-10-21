import { isAddress } from "viem";
import { REFERRAL_BPS } from "@/lib/contract";
import { readPpw } from "@/lib/server/chain";
import { listReceipts, listVideos, listWatchSessions } from "@/lib/server/db";
import { getEvents } from "@/lib/server/events";
import { error, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET ?referrer= -> what a referrer has earned, what's pending, and per-video breakdown. */
export async function GET(req: Request) {
  const referrer = new URL(req.url).searchParams.get("referrer");
  if (!referrer || !isAddress(referrer)) return error("Pass a referrer address");

  const [settledEvents, receipts, sessions, videos] = await Promise.all([
    getEvents({ name: ["Settled"] }).then((all) => all.filter((e) => String(e.args.referrer ?? "").toLowerCase() === referrer.toLowerCase())),
    listReceipts({ referrer }),
    listWatchSessions().then((all) => all.filter((s) => s.referrer === referrer.toLowerCase())),
    listVideos({ includeInactive: true }),
  ]);

  const earned = settledEvents.reduce((a, e) => a + BigInt(String(e.args.referralAmount ?? "0")), 0n);
  // Pending: unsettled spend by referred viewers x the referral rate (paid at the next hourly settlement,
  // provided the referrer's own payment to that creator has settled).
  let pendingSpend = 0n;
  for (const r of receipts) {
    const s = await readPpw<bigint>("settled", [r.viewer, r.creator, r.referrer]);
    const p = BigInt(r.cumulative_amount) - s;
    if (p > 0n) pendingSpend += p;
  }
  const titles = new Map(videos.map((v) => [v.id, v.title]));
  const perVideo = new Map<string, { title: string; viewers: Set<string>; seconds: number; spend: bigint }>();
  for (const s of sessions) {
    const row = perVideo.get(s.video_id) ?? { title: titles.get(s.video_id) ?? "Video", viewers: new Set(), seconds: 0, spend: 0n };
    row.viewers.add(s.viewer);
    row.seconds += s.seconds;
    row.spend += BigInt(s.amount);
    perVideo.set(s.video_id, row);
  }

  return json({
    earned: earned.toString(),
    pending: ((pendingSpend * REFERRAL_BPS) / 10_000n).toString(),
    referredViewers: new Set(sessions.map((s) => s.viewer)).size,
    videos: [...perVideo.entries()].map(([id, r]) => ({
      id,
      title: r.title,
      viewers: r.viewers.size,
      seconds: r.seconds,
      earnedEstimate: ((r.spend * REFERRAL_BPS) / 10_000n).toString(),
    })),
  });
}
