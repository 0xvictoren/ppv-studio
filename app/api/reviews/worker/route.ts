import { getVideo, listVideos, updateVideo } from "@/lib/server/db";
import { randomBytes } from "node:crypto";
import {
  getHls,
  getReview,
  listHlsIds,
  listIndexIds,
  listQueuedReviews,
  patchReview,
  putHls,
  putIndexEntry,
  type ReviewMatch,
  type TranscriptSegment,
} from "@/lib/server/content-db";
import { error, json } from "@/lib/server/http";
import { storageRef } from "@/lib/server/media";
import { workerAuthorized, workerDownloadUrl } from "@/lib/server/review";

export const dynamic = "force-dynamic";

/**
 * GET (worker) -> { jobs, backfill, package, published }.
 * jobs: uploads waiting for their originality check. backfill: published videos that were never
 * indexed (uploaded before the check existed). package: published videos to encrypt as HLS, with
 * their master key. published: index entries to compare against.
 */
export async function GET(req: Request) {
  if (!workerAuthorized(req)) return error("Unauthorized", 401);
  const origin = new URL(req.url).origin;
  const [queued, ids, videos] = await Promise.all([listQueuedReviews(), listIndexIds(), listVideos({ includeInactive: true })]);
  const indexed = new Set(ids.map((i) => i.id));

  const jobs = await Promise.all(
    queued.map(async (r) => ({
      id: r.id,
      creator: r.creator,
      title: r.title,
      description: r.description,
      downloadUrl: await workerDownloadUrl(r, origin),
    })),
  );
  const backfill = await Promise.all(
    videos
      .filter((v) => !indexed.has(v.content_cid))
      .slice(0, 5)
      .map(async (v) => ({
        id: v.content_cid,
        videoId: v.id,
        creator: v.creator,
        title: v.title,
        description: v.description,
        downloadUrl: await workerDownloadUrl(v, origin),
      })),
  );
  // Encrypted HLS for published videos in private storage. A packaging attempt that never finished
  // (worker stopped) is handed out again after a while, with the same key.
  const hlsIds = new Map((await listHlsIds()).map((h) => [h.id, h.status]));
  const toPackage = [];
  for (const v of videos.filter((v) => v.active && storageRef(v).kind !== "remote" && hlsIds.get(v.content_cid) !== "ready")) {
    if (toPackage.length >= 2) break;
    let row = await getHls(v.content_cid);
    if (row && Date.now() - new Date(row.created_at).getTime() < PACKAGING_RETRY_MS) continue;
    const kind = storageRef(v).kind === "r2" ? "r2" : "local";
    row = { id: v.content_cid, key: row?.key ?? randomBytes(32).toString("hex"), storage: kind, status: "packaging", segments: [], target_duration: 0, created_at: new Date().toISOString() };
    await putHls(row);
    toPackage.push({ id: v.content_cid, videoId: v.id, title: v.title, key: row.key, downloadUrl: await workerDownloadUrl(v, origin) });
  }
  return json({ jobs, backfill, package: toPackage, published: ids.filter((i) => i.video_id) });
}

const PACKAGING_RETRY_MS = 60 * 60 * 1000;

type Entry = { frames: string; audio: string; transcript: string; segments: TranscriptSegment[] };
type Body =
  | { kind: "review"; id: string; entry?: Entry; duration?: number; result?: { verdict: "passed" | "held" | "blocked"; score: number; matches: ReviewMatch[] }; error?: string }
  | { kind: "index"; id: string; videoId: string; entry?: Entry; duration?: number; error?: string };

/** The worker's measured length in whole seconds, if it sent a sane one. */
const measured = (d: unknown) => (typeof d === "number" && d > 0 && d < 7 * 24 * 3600 ? Math.round(d) : null);

const EMPTY: Entry = { frames: "", audio: "", transcript: "", segments: [] };

/** POST (worker): the result of a review, or the index entry for a backfilled video. */
export async function POST(req: Request) {
  if (!workerAuthorized(req)) return error("Unauthorized", 401);
  const body = (await req.json()) as Body;

  if (body.kind === "index") {
    const video = await getVideo(body.videoId);
    if (!video || video.content_cid !== body.id) return error("Video not found", 404);
    // A video the worker couldn't read gets an empty entry, so it isn't retried forever.
    await putIndexEntry({ id: video.content_cid, creator: video.creator, video_id: video.id, title: video.title, ...(body.entry ?? EMPTY) });
    // Videos published before the check carry the length their creator typed in; use the real one.
    const duration = measured(body.duration);
    if (duration && duration !== video.duration_seconds) await updateVideo(video.id, { duration_seconds: duration });
    return json({ ok: true });
  }

  const review = await getReview(body.id);
  if (!review) return error("Review not found", 404);
  if (body.error || !body.entry || !body.result) {
    await patchReview(review.id, { status: "failed", error: (body.error ?? "No result").slice(0, 500) });
    return json({ ok: true });
  }
  const { verdict, score, matches } = body.result;
  if (!["passed", "held", "blocked"].includes(verdict)) return error("Bad verdict");
  await putIndexEntry({ id: review.id, creator: review.creator, video_id: null, title: review.title, ...body.entry });
  const duration = measured(body.duration);
  await patchReview(review.id, {
    ...(duration ? { duration_seconds: duration } : {}),
    status: verdict,
    score: Math.max(0, Math.min(100, Math.round(score))),
    matches: matches.slice(0, 5),
    error: null,
  });
  return json({ ok: true });
}
