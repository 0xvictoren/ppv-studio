import { createReadStream, statSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { DATA_DIR, getVideo } from "@/lib/server/db";
import { verifyMedia } from "@/lib/server/upload-token";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** GET ?t=<download token> -> the video bytes, for the app's offline library only. */
export async function GET(req: Request) {
  const claim = verifyMedia(new URL(req.url).searchParams.get("t") ?? "", "download");
  if (!claim) return new Response("Download link expired", { status: 401 });
  const headers = { "cache-control": "no-store", "content-type": "video/mp4" };

  if (claim.file.startsWith("remote:")) {
    const video = await getVideo(claim.file.slice(7));
    if (!video) return new Response("Not found", { status: 404 });
    const upstream = await fetch(video.playback_url, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
    if (!upstream?.ok || !upstream.body) return new Response("The video's source isn't responding right now. Please try again in a minute.", { status: 502 });
    return new Response(upstream.body, {
      headers: { ...headers, "content-type": upstream.headers.get("content-type") ?? "video/mp4", ...(upstream.headers.get("content-length") ? { "content-length": upstream.headers.get("content-length")! } : {}) },
    });
  }
  if (!/^[0-9a-f-]{36}\.[a-z0-9]{2,4}$/.test(claim.file)) return new Response("Not found", { status: 404 });
  const file = path.join(DATA_DIR, "uploads", claim.file);
  let size: number;
  try {
    size = statSync(file).size;
  } catch {
    return new Response("Not found", { status: 404 });
  }
  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, { headers: { ...headers, "content-length": String(size) } });
}
