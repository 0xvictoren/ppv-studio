import { createReview, getReview, patchReview, type ReviewRow } from "@/lib/server/content-db";
import { error, json } from "@/lib/server/http";
import { reviewEnabled } from "@/lib/server/review";
import { sessionAddress } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/**
 * POST { contentCid, playbackUrl, title, description?, durationSeconds } -> { review }.
 * Queues an uploaded (not yet registered) video for the originality check. Idempotent per upload.
 */
export async function POST(req: Request) {
  const me = await sessionAddress();
  if (!me) return error("Sign in with your wallet first.", 401);
  const body = (await req.json()) as { contentCid?: string; playbackUrl?: string; title?: string; description?: string; durationSeconds?: number };
  const contentCid = body.contentCid?.trim();
  const playbackUrl = body.playbackUrl?.trim();
  if (!contentCid || contentCid.length > 300 || !playbackUrl || !body.title?.trim()) return error("Missing fields");
  // Private R2 uploads live under the uploader's own prefix (see /api/storage/upload).
  if (playbackUrl.startsWith("r2:") && !playbackUrl.startsWith(`r2:videos/${me}/`)) return error("That upload isn't yours.", 403);

  if (!reviewEnabled()) {
    const now = new Date().toISOString();
    const review: ReviewRow = {
      id: contentCid, creator: me, playback_url: playbackUrl, title: body.title.trim(), description: body.description ?? "",
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
    title: body.title.trim().slice(0, 140),
    description: (body.description ?? "").slice(0, 5000),
    duration_seconds: Math.max(0, Math.round(body.durationSeconds || 0)),
  });
  return json({ review }, { status: 201 });
}
