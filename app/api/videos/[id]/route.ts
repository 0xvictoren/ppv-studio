import { rm } from "node:fs/promises";
import path from "node:path";
import { ZERO_ADDRESS } from "@/lib/contract";
import { readPpw } from "@/lib/server/chain";
import { deleteHls, deleteIndexForVideo, getHls } from "@/lib/server/content-db";
import { DATA_DIR, deleteVideo, getVideo, listWatchSessions, updateVideo } from "@/lib/server/db";
import { error, json } from "@/lib/server/http";
import { storageRef } from "@/lib/server/media";
import { deleteObjects, r2Configured } from "@/lib/server/r2";
import { rateVideo } from "@/lib/server/rating";
import { sessionAddress } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
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
 * PATCH: re-sync cached price/active from chain after the creator changes them onchain,
 * and/or set { referralsEnabled } (creator only).
 */
export async function PATCH(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
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

/**
 * DELETE (creator only): remove the video for good: its listing, transcript and fingerprints,
 * encrypted stream and uploaded file. It must be unpublished onchain first (or not on the current
 * contract at all), so nobody can be billed for it afterwards. Receipts, watch history and passes
 * stay, and money already earned is untouched.
 */
export async function DELETE(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const me = await sessionAddress();
  if (!me) return error("Sign in with your wallet first.", 401);
  const video = await getVideo(params.id);
  if (!video) return error("Video not found", 404);
  if (me !== video.creator) return error("Only the creator can delete this video.", 403);
  const [creator, , active] = await readPpw<readonly [string, bigint, boolean]>("videos", [video.id]);
  if (creator !== ZERO_ADDRESS && active) return error("Unpublish the video before deleting it.", 409);

  await deleteVideo(video.id);
  await deleteIndexForVideo(video.id);
  const hls = await getHls(video.content_cid);
  await deleteHls(video.content_cid);

  // Files last, best effort: the video is already gone from the app if one of these fails.
  const ref = storageRef(video);
  const files: Promise<unknown>[] = [];
  if (ref.kind === "local") files.push(rm(path.join(DATA_DIR, "uploads", ref.file), { force: true }));
  if (ref.kind === "r2" && r2Configured()) files.push(deleteObjects(ref.key));
  if (hls?.storage === "local") files.push(rm(path.join(DATA_DIR, "hls", video.content_cid), { recursive: true, force: true }));
  if (hls?.storage === "r2" && r2Configured()) files.push(deleteObjects(`hls/${video.content_cid}/`));
  for (const r of await Promise.allSettled(files)) if (r.status === "rejected") console.error(`[videos] couldn't delete a file of ${video.id}:`, r.reason);

  return json({ ok: true });
}
