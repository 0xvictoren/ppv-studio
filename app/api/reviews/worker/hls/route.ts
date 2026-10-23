import { getHls, putHls, type HlsSegment } from "@/lib/server/content-db";
import { hlsSegmentPath } from "@/lib/server/hls";
import { error, json } from "@/lib/server/http";
import { presignUpload } from "@/lib/server/r2";
import { workerAuthorized } from "@/lib/server/review";

export const dynamic = "force-dynamic";

const SEGMENT = /^seg\d{5}\.ts$/;

/**
 * POST (worker), two steps for one packaged video:
 *  { id, files: ["seg00000.ts", ...] } -> { targets: { name: url } }  where to PUT each encrypted segment
 *  { id, done: true, segments: [{ name, duration }], targetDuration } -> marks the HLS version ready
 */
export async function POST(req: Request) {
  if (!workerAuthorized(req)) return error("Unauthorized", 401);
  const body = (await req.json()) as { id?: string; files?: string[]; done?: boolean; segments?: HlsSegment[]; targetDuration?: number };
  const hls = typeof body.id === "string" ? await getHls(body.id) : null;
  if (!hls) return error("Not packaging", 404);

  if (!body.done) {
    const files = Array.isArray(body.files) ? body.files : [];
    if (!files.length || files.length > 20_000 || !files.every((f) => typeof f === "string" && SEGMENT.test(f))) return error("Bad file list");
    const origin = new URL(req.url).origin;
    const targets: Record<string, string> = {};
    for (const f of files) {
      targets[f] =
        hls.storage === "r2"
          ? await presignUpload(hlsSegmentPath(hls.id, f), "video/mp2t", 6 * 60 * 60)
          : `${origin}/api/reviews/worker/hls/file?id=${encodeURIComponent(hls.id)}&name=${f}`;
    }
    return json({ targets });
  }

  const segments = Array.isArray(body.segments) ? body.segments : [];
  const valid = segments.length > 0 && segments.every((s) => SEGMENT.test(s.name) && typeof s.duration === "number" && s.duration > 0 && s.duration < 60);
  if (!valid) return error("Bad segment list");
  const targetDuration = Math.max(...segments.map((s) => s.duration));
  await putHls({ ...hls, status: "ready", segments: segments.map((s) => ({ name: s.name, duration: s.duration })), target_duration: targetDuration });
  return json({ ok: true });
}
