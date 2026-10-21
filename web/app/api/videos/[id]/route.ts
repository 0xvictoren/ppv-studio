import { readPpw } from "@/lib/server/chain";
import { getVideo, listWatchSessions, updateVideo } from "@/lib/server/db";
import { error, json } from "@/lib/server/http";
import { rateVideo } from "@/lib/server/rating";
import { sessionAddress } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const video = await getVideo(params.id);
  if (!video) return error("Video not found", 404);
  const sessions = await listWatchSessions({ videoId: video.id });
  return json({
    video: (() => {
      const rating = rateVideo(video, sessions);
      return { ...video, ...rating, views: rating.plays, watch_seconds: sessions.reduce((a, s) => a + s.seconds, 0) };
    })(),
  });
}

/**
 * PATCH: re-sync cached price/active from chain after the creator changes them on-chain,
 * and/or set { referralsEnabled } (creator only).
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const me = await sessionAddress();
  const video = await getVideo(params.id);
  if (!video) return error("Video not found", 404);
  if (me !== video.creator) return error("Only the creator can update this video.", 403);
  const body = (await req.json().catch(() => ({}))) as { referralsEnabled?: boolean };
  const [, price, active] = await readPpw<readonly [string, bigint, boolean]>("videos", [video.id]);
  const patch = {
    ...(price > 0n ? { price_per_hour: price.toString(), active } : {}),
    ...(typeof body.referralsEnabled === "boolean" ? { referrals_enabled: body.referralsEnabled } : {}),
  };
  await updateVideo(video.id, patch);
  return json({ ok: true, ...patch });
}
