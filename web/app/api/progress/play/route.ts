import { getVideo, getWatchSession, upsertWatchSession } from "@/lib/server/db";
import { error, json } from "@/lib/server/http";
import { loadProgress } from "@/lib/server/progress";
import { authViewer } from "@/lib/server/viewer-auth";

export const dynamic = "force-dynamic";

const g = globalThis as unknown as { __ppwPlayPings?: Map<string, number> };

/**
 * POST { viewer, videoId, sessionId, freeSeconds } — record replay time that costs nothing
 * (seconds already paid for, or under a 30-day pass) so ratings see rewatches.
 * Credited by wall clock: never more than the real time since the last ping.
 */
export async function POST(req: Request) {
  const { viewer, videoId, sessionId, freeSeconds, creator, referrer } = (await req.json()) as {
    viewer: string;
    videoId: string;
    sessionId: string;
    freeSeconds: number;
    creator?: string;
    referrer?: string;
  };
  if (!(await authViewer(req, viewer))) return error("Not authorized", 401);
  const video = await getVideo(videoId);
  if (!video) return error("Video not found", 404);
  const progress = await loadProgress(viewer, video);
  if (!progress || progress.covered_seconds === 0) return error("Nothing paid for yet", 409);

  const id = String(sessionId).slice(0, 64);
  const pings = (g.__ppwPlayPings ??= new Map());
  const now = Date.now();
  const last = pings.get(id) ?? now - 65_000;
  pings.set(id, now);
  const existing = await getWatchSession(id);
  const already = existing?.free_seconds ?? 0;
  const allowed = Math.ceil((now - last) / 1000) + 5;
  const credited = Math.min(Math.max(0, Math.floor(freeSeconds) - already), allowed);

  await upsertWatchSession({
    id,
    viewer,
    creator: existing?.creator ?? creator ?? video.creator,
    referrer: existing?.referrer ?? referrer ?? "0x0000000000000000000000000000000000000000",
    video_id: video.id,
    seconds: existing?.seconds ?? 0,
    free_seconds: already + credited,
    amount: existing?.amount ?? "0",
  });
  return json({ ok: true, freeSeconds: already + credited });
}
