import { isMock } from "@/lib/env";
import { createReview, getReview, patchReview, type ReviewRow } from "@/lib/server/content-db";
import { error, json } from "@/lib/server/http";
import { reviewEnabled } from "@/lib/server/review";
import { sessionAddress } from "@/lib/server/session";
import { uploadIsIssued } from "@/lib/server/upload-token";

export const dynamic = "force-dynamic";

/**
 * POST { contentCid, playbackUrl, uploadRef, title, description?, durationSeconds } -> { review }.
 * Queues an uploaded (not yet registered) video for the originality check. Idempotent per upload.
 */
export async function POST(req: Request) {
  const me = await sessionAddress();
  if (!me) return error("Sign in with your wallet first.", 401);
  const body = (await req.json()) as { contentCid?: unknown; playbackUrl?: unknown; uploadRef?: unknown; title?: unknown; description?: unknown; durationSeconds?: unknown };
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const contentCid = str(body.contentCid);
  const playbackUrl = str(body.playbackUrl);
  const title = str(body.title);
  const description = str(body.description);
  if (!contentCid || contentCid.length > 300 || !playbackUrl || !title) return error("Missing fields");
  // Only locations our storage endpoint issued to this wallet: never a URL the uploader controls.
  if (!isMock && !uploadIsIssued(me, contentCid, playbackUrl, body.uploadRef)) return error("That upload isn't yours. Upload the video again.", 403);

  if (!reviewEnabled()) {
    const now = new Date().toISOString();
    const review: ReviewRow = {
      id: contentCid, creator: me, playback_url: playbackUrl, title, description,
      duration_seconds: 0, status: "passed", score: null, matches: [], note: null, error: null, created_at: now, updated_at: now,
    };
    return json({ review });
  }

  const existing = await getReview(contentCid);
  if (existing) {
    if (existing.creator !== me) return error("That upload isn't yours.", 403);
    if (existing.status === "failed") {
      await patchReview(existing.id, { status: "queued", error: null });
      return json({ review: { ...existing, status: "queued", error: null } });
    }
    return json({ review: existing });
  }
  const review = await createReview({
    id: contentCid,
    creator: me,
    playback_url: playbackUrl,
    title: title.slice(0, 140),
    description: description.slice(0, 5000),
    // The worker replaces this with the duration it measures.
    duration_seconds: Math.max(0, Math.round(Number(body.durationSeconds) || 0)),
  });
  return json({ review }, { status: 201 });
}
