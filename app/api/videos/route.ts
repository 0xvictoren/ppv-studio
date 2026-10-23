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
 * POST metadata after on-chain registration. The VideoRegistered event is checked
 * on-chain before anything is stored.
 */
export async function POST(req: Request) {
  const me = await sessionAddress();
  if (!me) return error("Sign in with your wallet first.", 401);

  const body = (await req.json()) as {
    txHash: Hex;
    contentCid: string;
    title: string;
    description?: string;
    category?: string;
    referralsEnabled?: boolean;
    thumbnailUrl?: string | null;
    playbackUrl: string;
    durationSeconds: number;
  };
  if (!body.txHash || !body.contentCid || !body.title?.trim() || !body.playbackUrl) return error("Missing fields");
  if (body.thumbnailUrl && body.thumbnailUrl.length > 500_000) return error("Thumbnail too large");

  // Only uploads that passed the originality check (or were held and explained) get listed.
  if (reviewEnabled()) {
    const review = await getReview(body.contentCid);
    if (!review || review.creator !== me || review.playback_url !== body.playbackUrl) return error("Run the originality check before publishing.", 422);
    if (review.status === "blocked") return error("This video matches one already on PayPerWatch, so it can't be published.", 409);
    if (review.status !== "passed" && review.status !== "explained") return error("This video's originality check isn't finished.", 409);
  }

  const videoId = computeVideoId(me as Hex, body.contentCid).toLowerCase();

  // Find VideoRegistered(videoId, creator=me) in the transaction.
  let price: bigint | null = null;
  if (isMock) {
    const ev = (await getEvents({ name: ["VideoRegistered"], videoId })).find((e) => e.txHash === body.txHash);
    if (ev && String(ev.args.creator).toLowerCase() === me) price = BigInt(String(ev.args.pricePerHour));
  } else {
    const receipt = await publicClient.waitForTransactionReceipt({ hash: body.txHash, timeout: 30_000 });
    if (receipt.status !== "success") return error("That transaction failed on-chain.");
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
  if (price === null) return error("Couldn't find this video's registration on-chain.", 422);
  if (price === 0n || price > MAX_PRICE_PER_HOUR) return error("Invalid price");

  // Defensive: confirm current on-chain state too.
  const [creator] = await readPpw<readonly [string, bigint, boolean]>("videos", [videoId]);
  if (creator.toLowerCase() !== me) return error("Video isn't registered to your wallet.", 422);

  const row = await insertVideo({
    id: videoId,
    creator: me,
    title: body.title.trim().slice(0, 140),
    description: (body.description ?? "").slice(0, 5000),
    category: isCategory(body.category) ? body.category : "other",
    referrals_enabled: body.referralsEnabled === true,
    thumbnail_url: body.thumbnailUrl ?? null,
    content_cid: body.contentCid,
    playback_url: body.playbackUrl,
    price_per_hour: price.toString(),
    duration_seconds: Math.max(0, Math.round(body.durationSeconds || 0)),
    register_tx: body.txHash,
  });
  await linkIndexToVideo(body.contentCid, row.id);
  return json({ video: row }, { status: 201 });
}
