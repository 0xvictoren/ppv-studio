import "server-only";
import { isMock } from "../env";
import type { VideoRow } from "./db";
import { storageRef } from "./media";
import { presignRead } from "./r2";
import { signMedia } from "./upload-token";

// Originality check. Uploads are fingerprinted and transcribed by the review worker
// (worker/review_worker.py), which runs on a machine with ffmpeg and talks to /api/reviews/worker.
// A video can only be published once its review passed, or was held and the creator explained
// what it adds. Copies are blocked.

/** Off in mock mode (tests) or with CONTENT_REVIEW=off. */
export function reviewEnabled() {
  return !isMock && process.env.CONTENT_REVIEW !== "off";
}

/** The worker authenticates with `Authorization: Bearer $REVIEW_WORKER_SECRET`. */
export function workerAuthorized(req: Request) {
  const secret = process.env.REVIEW_WORKER_SECRET;
  return !!secret && req.headers.get("authorization") === `Bearer ${secret}`;
}

const WORKER_URL_TTL_S = 6 * 60 * 60;

/** A link the worker can download the video bytes from. */
export async function workerDownloadUrl(video: Pick<VideoRow, "playback_url">, origin: string): Promise<string> {
  const ref = storageRef(video);
  if (ref.kind === "r2") return presignRead(ref.key, WORKER_URL_TTL_S);
  if (ref.kind === "local") {
    const token = signMedia({ kind: "stream", file: ref.file, viewer: "review-worker", exp: Date.now() + WORKER_URL_TTL_S * 1000 });
    return `${origin}/media/${ref.file}?t=${encodeURIComponent(token)}`;
  }
  return ref.url;
}
