import { listVideos, listWatchSessions } from "@/lib/server/db";
import { error, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET ?viewer= or ?creator= : watch sessions with video titles (analytics). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const viewer = url.searchParams.get("viewer") ?? undefined;
  const creator = url.searchParams.get("creator") ?? undefined;
  if (!viewer && !creator) return error("Pass viewer or creator");
  const [sessions, videos] = await Promise.all([listWatchSessions({ viewer, creator }), listVideos({ includeInactive: true })]);
  const titles = new Map(videos.map((v) => [v.id, v.title]));
  return json({ sessions: sessions.map((s) => ({ ...s, title: titles.get(s.video_id) ?? "Unknown video" })) });
}
