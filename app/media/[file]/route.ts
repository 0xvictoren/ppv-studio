import { createReadStream, statSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { DATA_DIR } from "@/lib/server/db";
import { verifyMedia } from "@/lib/server/upload-token";

export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = { mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", mkv: "video/x-matroska", ogv: "video/ogg" };

/**
 * Serves locally stored videos with HTTP Range support so players can seek.
 * Requires a short-lived, viewer-bound stream token (?t=) from POST /api/stream.
 */
export async function GET(req: Request, props: { params: Promise<{ file: string }> }) {
  const params = await props.params;
  const m = params.file.match(/^([0-9a-f-]{36})\.([a-z0-9]{2,4})$/);
  if (!m) return new Response("Not found", { status: 404 });
  const claim = verifyMedia(new URL(req.url).searchParams.get("t") ?? "", "stream");
  if (!claim || claim.file !== params.file) return new Response("This link has expired. Open the video in PayPerWatch to keep watching.", { status: 403 });
  const file = path.join(DATA_DIR, "uploads", params.file);
  let size: number;
  try {
    size = statSync(file).size;
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const type = TYPES[m[2]] ?? "application/octet-stream";
  const range = req.headers.get("range")?.match(/bytes=(\d*)-(\d*)/);
  const base = { "content-type": type, "accept-ranges": "bytes", "cache-control": "private, max-age=3600", "content-disposition": "inline" };

  if (!range) {
    return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, { headers: { ...base, "content-length": String(size) } });
  }
  let start = range[1] ? Number(range[1]) : size - Number(range[2]);
  let end = range[1] && range[2] ? Number(range[2]) : size - 1;
  if (!range[1] && !range[2]) [start, end] = [0, size - 1];
  if (start >= size || start < 0 || end < start) {
    return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
  }
  end = Math.min(end, size - 1);
  return new Response(Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream, {
    status: 206,
    headers: { ...base, "content-length": String(end - start + 1), "content-range": `bytes ${start}-${end}/${size}` },
  });
}
