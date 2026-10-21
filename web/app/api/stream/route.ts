import { getVideo } from "@/lib/server/db";
import { error, json } from "@/lib/server/http";
import { storageRef } from "@/lib/server/media";
import { presignRead } from "@/lib/server/r2";
import { loadProgress, passActive } from "@/lib/server/progress";
import { signMedia } from "@/lib/server/upload-token";
import { authViewer } from "@/lib/server/viewer-auth";

export const dynamic = "force-dynamic";

const STREAM_TTL_MS = 3 * 60 * 60 * 1000;

/**
 * POST { viewer, videoId } -> { url }. Local uploads are only streamed through short-lived,
 * viewer-bound links, so a raw file URL can't be shared around. Requires a viewer who can be
 * billed (active session key) or holds a free-replay pass.
 */
export async function POST(req: Request) {
  const { viewer, videoId } = (await req.json()) as { viewer: string; videoId: string };
  const how = await authViewer(req, viewer);
  if (!how) return error("Not authorized", 401);
  const video = await getVideo(videoId);
  if (!video) return error("Video not found", 404);
  const ref = storageRef(video);
  if (ref.kind === "remote") return json({ url: ref.url });
  if (how !== "session-key" && !passActive(await loadProgress(viewer, video))) {
    return error("Add funds to start watching.", 402);
  }
  if (ref.kind === "r2") return json({ url: await presignRead(ref.key, STREAM_TTL_MS / 1000) });
  const token = signMedia({ kind: "stream", file: ref.file, viewer: viewer.toLowerCase(), exp: Date.now() + STREAM_TTL_MS });
  return json({ url: `/media/${ref.file}?t=${encodeURIComponent(token)}` });
}
