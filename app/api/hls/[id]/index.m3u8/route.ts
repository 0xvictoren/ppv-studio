import { getHls } from "@/lib/server/content-db";
import { getVideo } from "@/lib/server/db";
import { renderPlaylist } from "@/lib/server/hls";
import { verifyMedia } from "@/lib/server/upload-token";

export const dynamic = "force-dynamic";

/** GET ?t=<hls token from /api/stream> -> the encrypted video's playlist for this viewer. */
export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const video = await getVideo(params.id);
  const claim = verifyMedia(new URL(req.url).searchParams.get("t") ?? "", "hls");
  if (!video || !claim || claim.file !== video.content_cid) return new Response("This link has expired. Open the video in PayPerWatch to keep watching.", { status: 403 });
  const hls = await getHls(video.content_cid);
  if (hls?.status !== "ready") return new Response("Not found", { status: 404 });
  return new Response(await renderPlaylist(hls, video.id, new URL(req.url).searchParams.get("t")!), {
    headers: { "content-type": "application/vnd.apple.mpegurl", "cache-control": "private, no-store" },
  });
}
