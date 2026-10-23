import { isAddress, type Hex } from "viem";
import { ZERO_ADDRESS } from "@/lib/contract";
import { readPpw } from "@/lib/server/chain";
import { getReceipt, getVideo, getWatchSession, listReceipts, upsertWatchSession } from "@/lib/server/db";
import { error, json } from "@/lib/server/http";
import { applyPaidCoverage } from "@/lib/server/progress";
import { ReceiptError, verifyAndStoreReceipt, type RawReceipt } from "@/lib/server/receipts";
import { requestMilestoneSettlement } from "@/lib/server/settle";

export const dynamic = "force-dynamic";

type Body = {
  receipt: RawReceipt;
  signature: Hex;
  /** Which seconds of the video are now paid for (base64 bitmap) for this session's video. */
  watch?: { sessionId: string; videoId: string; coverage?: string; freeSeconds?: number };
};

const SLACK_SECONDS = 15; // rounding + tick jitter allowance per post

/**
 * POST a signed EIP-712 receipt. Accepts application/json or text/plain (sendBeacon).
 * Only the highest cumulativeAmount per (viewer, creator, referrer) is kept.
 * The receipt's new amount also pays for newly watched seconds of the video: the server
 * accepts at most as many new seconds as the amount covers, and settles onchain as soon as
 * paid progress crosses 10%, 25%, 50%, 75% or 100%.
 */
export async function POST(req: Request) {
  let body: Body;
  try {
    body = JSON.parse(await req.text());
  } catch {
    return error("Invalid JSON");
  }
  let verified;
  try {
    verified = await verifyAndStoreReceipt(body.receipt, body.signature, { videoId: body.watch?.videoId });
  } catch (e) {
    if (e instanceof ReceiptError) return error(e.message, e.status);
    throw e;
  }
  const { receipt, previous } = verified;
  const watch = body.watch;

  if (watch?.sessionId && watch.videoId) {
    const video = await getVideo(watch.videoId);
    if (video && video.creator === receipt.creator.toLowerCase()) {
      const [, price] = await readPpw<readonly [string, bigint, boolean]>("videos", [video.id]);
      const pricePerHour = price > 0n ? price : BigInt(video.price_per_hour);
      const paidDelta = receipt.cumulativeAmount - previous;
      const paidSeconds = pricePerHour > 0n ? Number((paidDelta * 3600n) / pricePerHour) : 0;

      const { progress, milestone, added } = await applyPaidCoverage(receipt.viewer, video, watch.coverage, paidSeconds + SLACK_SECONDS);
      if (milestone) requestMilestoneSettlement({ viewer: receipt.viewer, creator: receipt.creator, referrer: receipt.referrer });

      const id = String(watch.sessionId).slice(0, 64);
      const existing = await getWatchSession(id);
      await upsertWatchSession({
        id,
        viewer: receipt.viewer,
        creator: receipt.creator,
        referrer: receipt.referrer,
        video_id: video.id,
        seconds: (existing?.seconds ?? 0) + added,
        free_seconds: existing?.free_seconds ?? 0,
        amount: (BigInt(existing?.amount ?? "0") + paidDelta).toString(),
      });
      return json({ ok: true, cumulativeAmount: receipt.cumulativeAmount.toString(), coveredSeconds: progress.covered_seconds, passUntil: progress.pass_until });
    }
  }
  return json({ ok: true, cumulativeAmount: receipt.cumulativeAmount.toString() });
}

/**
 * GET ?viewer=&creator=[&referrer=] -> { cumulative, settled } for one lane (the client's starting point)
 * GET ?viewer= | ?creator= | ?referrer= -> receipts + unsettled total
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const viewer = url.searchParams.get("viewer");
  const creator = url.searchParams.get("creator");
  const referrerParam = url.searchParams.get("referrer");
  if (viewer && creator) {
    const referrer = referrerParam ?? ZERO_ADDRESS;
    if (!isAddress(viewer) || !isAddress(creator) || !isAddress(referrer)) return error("Bad address");
    const [stored, settled] = await Promise.all([getReceipt(viewer, creator, referrer), readPpw<bigint>("settled", [viewer, creator, referrer])]);
    return json({ cumulative: stored?.cumulative_amount ?? "0", settled: settled.toString() });
  }
  if (!viewer && !creator && !referrerParam) return error("Pass viewer, creator or referrer");
  const rows = await listReceipts({ viewer: viewer ?? undefined, creator: creator ?? undefined, referrer: referrerParam ?? undefined });
  // Use live onchain settled amounts so "pending" is exact even between settlements.
  const withSettled = await Promise.all(
    rows.map(async (r) => {
      const s = await readPpw<bigint>("settled", [r.viewer, r.creator, r.referrer]);
      const pending = BigInt(r.cumulative_amount) - s;
      return { ...r, settled_amount: s.toString(), pending: (pending > 0n ? pending : 0n).toString() };
    }),
  );
  const pendingTotal = withSettled.reduce((a, r) => a + BigInt(r.pending), 0n);
  return json({ receipts: withSettled, pendingTotal: pendingTotal.toString() });
}
