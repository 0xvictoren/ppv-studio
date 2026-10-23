import { createWriteStream, mkdirSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { getHls } from "@/lib/server/content-db";
import { DATA_DIR } from "@/lib/server/db";
import { error, json } from "@/lib/server/http";
import { workerAuthorized } from "@/lib/server/review";

export const dynamic = "force-dynamic";

/** PUT ?id=&name= (worker, local storage only): one encrypted HLS segment. */
export async function PUT(req: Request) {
  if (!workerAuthorized(req)) return error("Unauthorized", 401);
  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "";
  const name = url.searchParams.get("name") ?? "";
  const hls = await getHls(id);
  if (!hls || hls.storage !== "local" || !/^seg\d{5}\.ts$/.test(name) || !req.body) return error("Bad segment");
  const dir = path.join(DATA_DIR, "hls", id);
  if (path.relative(path.join(DATA_DIR, "hls"), dir).startsWith("..")) return error("Bad segment");
  mkdirSync(dir, { recursive: true });
  await pipeline(Readable.fromWeb(req.body as never), createWriteStream(path.join(dir, name)));
  return json({ ok: true });
}
