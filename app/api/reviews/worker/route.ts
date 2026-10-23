import { getVideo, listVideos } from "@/lib/server/db";
import {
  getReview,
  listIndexIds,
  listQueuedReviews,
  patchReview,
  putIndexEntry,
  type ReviewMatch,
  type TranscriptSegment,
} from "@/lib/server/content-db";
import { error, json } from "@/lib/server/http";
import { workerAuthorized, workerDownloadUrl } from "@/lib/server/review";

export const dynamic = "force-dynamic";

/**
 * GET (worker) -> { jobs, backfill, published }.
 * jobs: uploads waiting for their originality check. backfill: published videos that were never
 * indexed (uploaded before the check existed). published: index entries to compare against.
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
  return json({ jobs, backfill, published: ids.filter((i) => i.video_id) });
}

type Entry = { frames: string; audio: string; transcript: string; segments: TranscriptSegment[] };
type Body =
  | { kind: "review"; id: string; entry?: Entry; result?: { verdict: "passed" | "held" | "blocked"; score: number; matches: ReviewMatch[] }; error?: string }
  | { kind: "index"; id: string; videoId: string; entry?: Entry; error?: string };

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
  await patchReview(review.id, {
    status: verdict,
    score: Math.max(0, Math.min(100, Math.round(score))),
    matches: matches.slice(0, 5),
    error: null,
  });
  return json({ ok: true });
}
