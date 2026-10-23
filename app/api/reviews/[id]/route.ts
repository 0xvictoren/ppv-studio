import { getReview, patchReview } from "@/lib/server/content-db";
import { error, json } from "@/lib/server/http";
import { NOTE_MAX, NOTE_MIN } from "@/lib/review";
import { sessionAddress } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** GET -> { review }. The uploader polls this while the worker checks the video. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const me = await sessionAddress();
  if (!me) return error("Sign in with your wallet first.", 401);
  const review = await getReview(params.id);
  if (!review || review.creator !== me) return error("Review not found", 404);
  return json({ review });
}

/** POST { note } on a held review: the creator explains what the video adds, which releases it. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const me = await sessionAddress();
  if (!me) return error("Sign in with your wallet first.", 401);
  const review = await getReview(params.id);
  if (!review || review.creator !== me) return error("Review not found", 404);
  if (review.status !== "held") return error("Only held videos need an explanation.", 409);
  const note = String(((await req.json()) as { note?: string }).note ?? "").trim();
  if (note.length < NOTE_MIN) return error(`Tell viewers a bit more: at least ${NOTE_MIN} characters.`);
  await patchReview(review.id, { status: "explained", note: note.slice(0, NOTE_MAX) });
  return json({ review: { ...review, status: "explained", note: note.slice(0, NOTE_MAX) } });
}
