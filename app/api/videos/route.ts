import { decodeEventLog, type Hex } from "viem";
import { isCategory } from "@/lib/categories";
import { computeVideoId, ppwAbi, PPW_ADDRESS } from "@/lib/contract";
import { isMock } from "@/lib/env";
import { MAX_PRICE_PER_HOUR } from "@/lib/money";
import { publicClient, readPpw } from "@/lib/server/chain";
import { getReview, linkIndexToVideo } from "@/lib/server/content-db";
import { insertVideo, listVideos, listWatchSessions, type VideoRow, type WatchSessionRow } from "@/lib/server/db";
import { getEvents } from "@/lib/server/events";
import { error, json } from "@/lib/server/http";
import { rateVideo, type Rating } from "@/lib/server/rating";
import { reviewEnabled } from "@/lib/server/review";
import { sessionAddress } from "@/lib/server/session";
import { uploadIsIssued } from "@/lib/server/upload-token";

export const dynamic = "force-dynamic";

export type VideoListItem = VideoRow & { views: number; watch_seconds: number } & Rating;

/** GET ?q=&sort=newest|top_rated|cheapest|most_watched&creator=&category= */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.toLowerCase().trim();
  const sort = url.searchParams.get("sort") ?? "newest";
  const creator = url.searchParams.get("creator") ?? undefined;
  const cat = url.searchParams.get("category");
  const category = isCategory(cat) ? cat : undefined;

  const [videos, sessions] = await Promise.all([
    listVideos({ creator, category, includeInactive: !!creator }),
    listWatchSessions(creator ? { creator } : {}),
  ]);
  const byVideo = new Map<string, WatchSessionRow[]>();
  for (const s of sessions) byVideo.set(s.video_id, [...(byVideo.get(s.video_id) ?? []), s]);

  let items: VideoListItem[] = videos.map((v) => {
    const vs = byVideo.get(v.id) ?? [];
    const rating = rateVideo(v, vs);
    return { ...v, ...rating, views: rating.plays, watch_seconds: vs.reduce((a, s) => a + s.seconds, 0) };
  });
  if (q) items = items.filter((v) => v.title.toLowerCase().includes(q) || v.description.toLowerCase().includes(q));
  if (sort === "cheapest") items.sort((a, b) => (BigInt(a.price_per_hour) < BigInt(b.price_per_hour) ? -1 : 1));
  if (sort === "most_watched") items.sort((a, b) => b.watch_seconds - a.watch_seconds);
  if (sort === "top_rated") items.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1) || b.raters - a.raters);
  return json({ videos: items });
}

/**
 * POST metadata after onchain registration. The VideoRegistered event is checked
 * onchain before anything is stored.
 */
export async function POST(req: Request) {
  const me = await sessionAddress();
  if (!me) return error("Sign in with your wallet first.", 401);

  const body = (await req.json()) as {
    txHash: unknown;
    contentCid: unknown;
    uploadRef?: unknown;
    title: unknown;
    description?: unknown;
    category?: string;
    referralsEnabled?: boolean;
    thumbnailUrl?: unknown;
    playbackUrl: unknown;
    durationSeconds: unknown;
  };
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const txHash = str(body.txHash) as Hex;
  const contentCid = str(body.contentCid);
  const playbackUrl = str(body.playbackUrl);
  const title = str(body.title);
  const thumbnailUrl = typeof body.thumbnailUrl === "string" ? body.thumbnailUrl : null;
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash) || !contentCid || !title || !playbackUrl) return error("Missing fields");
  if (thumbnailUrl && thumbnailUrl.length > 500_000) return error("Thumbnail too large");

  // The length prices downloads and agent transcripts, so prefer the worker's measurement.
  let durationSeconds = Math.max(0, Math.round(Number(body.durationSeconds) || 0));
  if (reviewEnabled()) {
    // Only uploads that passed the originality check (or were held and explained) get listed.
    const review = await getReview(contentCid);
    if (!review || review.creator !== me || review.playback_url !== playbackUrl) return error("Run the originality check before publishing.", 422);
    if (review.status === "blocked") return error("This video matches one already on PayPerWatch, so it can't be published.", 409);
    if (review.status !== "passed" && review.status !== "explained") return error("This video's originality check isn't finished.", 409);
    if (review.duration_seconds > 0) durationSeconds = review.duration_seconds;
  } else if (!isMock && !uploadIsIssued(me, contentCid, playbackUrl, body.uploadRef)) {
    return error("That upload isn't yours. Upload the video again.", 403);
  }

  const videoId = computeVideoId(me as Hex, contentCid).toLowerCase();

  // Find VideoRegistered(videoId, creator=me) in the transaction.
  let price: bigint | null = null;
  if (isMock) {
    const ev = (await getEvents({ name: ["VideoRegistered"], videoId })).find((e) => e.txHash === txHash);
    if (ev && String(ev.args.creator).toLowerCase() === me) price = BigInt(String(ev.args.pricePerHour));
  } else {
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 30_000 });
    if (receipt.status !== "success") return error("That transaction failed onchain.");
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== PPW_ADDRESS.toLowerCase()) continue;
      try {
        const ev = decodeEventLog({ abi: ppwAbi, data: log.data, topics: log.topics });
        if (
          ev.eventName === "VideoRegistered" &&
          ev.args.videoId.toLowerCase() === videoId &&
          ev.args.creator.toLowerCase() === me
        ) {
          price = ev.args.pricePerHour;
        }
      } catch {
        /* not ours */
      }
    }
  }
  if (price === null) return error("Couldn't find this video's registration onchain.", 422);
  if (price === 0n || price > MAX_PRICE_PER_HOUR) return error("Invalid price");

  // Defensive: confirm current onchain state too.
  const [creator] = await readPpw<readonly [string, bigint, boolean]>("videos", [videoId]);
  if (creator.toLowerCase() !== me) return error("Video isn't registered to your wallet.", 422);

  const row = await insertVideo({
    id: videoId,
    creator: me,
    title: title.slice(0, 140),
    description: str(body.description).slice(0, 5000),
    category: isCategory(body.category) ? body.category : "other",
    referrals_enabled: body.referralsEnabled === true,
    thumbnail_url: thumbnailUrl,
    content_cid: contentCid,
    playback_url: playbackUrl,
    price_per_hour: price.toString(),
    duration_seconds: durationSeconds,
    register_tx: txHash,
  });
  await linkIndexToVideo(contentCid, row.id);
  return json({ video: row }, { status: 201 });
}
