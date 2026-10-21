import { readPpw } from "@/lib/server/chain";
import { getVideo } from "@/lib/server/db";
import { error, json } from "@/lib/server/http";
import { loadProgress, toDTO } from "@/lib/server/progress";
import { authViewer } from "@/lib/server/viewer-auth";

export const dynamic = "force-dynamic";

/** GET ?viewer=&videoId= -> the viewer's own paid-seconds bitmap and pass (auth required: it's watch history). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const viewer = url.searchParams.get("viewer") ?? "";
  const videoId = url.searchParams.get("videoId") ?? "";
  if (!(await authViewer(req, viewer))) return error("Not authorized", 401);
  const video = await getVideo(videoId);
  if (!video) return error("Video not found", 404);
  const [, price] = await readPpw<readonly [string, bigint, boolean]>("videos", [video.id]);
  const progress = await loadProgress(viewer, video);
  return json({ progress: toDTO(progress, video, price > 0n ? price : BigInt(video.price_per_hour)) });
}
