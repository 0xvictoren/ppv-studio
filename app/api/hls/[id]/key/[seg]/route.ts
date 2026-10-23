import { getHls } from "@/lib/server/content-db";
import { getVideo } from "@/lib/server/db";
import { authorizeSegmentKey } from "@/lib/server/hls";
import { verifyMedia } from "@/lib/server/upload-token";

export const dynamic = "force-dynamic";

/** GET ?t= -> the 16-byte AES key for one segment, if this viewer has paid for it (see lib/server/hls.ts). */
export async function GET(req: Request, props: { params: Promise<{ id: string; seg: string }> }) {
  const params = await props.params;
  const video = await getVideo(params.id);
  const claim = verifyMedia(new URL(req.url).searchParams.get("t") ?? "", "hls");
  if (!video || !claim || claim.file !== video.content_cid) return new Response("Link expired", { status: 403 });
  const hls = await getHls(video.content_cid);
  if (hls?.status !== "ready") return new Response("Not found", { status: 404 });
  const decision = await authorizeSegmentKey(claim.viewer, video, hls, Number(params.seg));
  if (!decision.ok) return Response.json({ error: decision.error }, { status: decision.status, headers: { "cache-control": "no-store" } });
  return new Response(new Uint8Array(decision.key), { headers: { "content-type": "application/octet-stream", "cache-control": "private, no-store" } });
}
