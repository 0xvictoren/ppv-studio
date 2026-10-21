import { createWriteStream, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { DATA_DIR } from "@/lib/server/db";
import { error, json } from "@/lib/server/http";
import { sessionAddress } from "@/lib/server/session";
import { verifyUpload } from "@/lib/server/upload-token";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");

/** PUT ?token=… with the raw video bytes. Streams to disk; never buffers the whole file. */
export async function PUT(req: Request) {
  const claim = verifyUpload(new URL(req.url).searchParams.get("token") ?? "");
  if (!claim) return error("Upload link expired. Please try again.", 401);
  if ((await sessionAddress()) !== claim.addr) return error("Sign in with the wallet that started this upload.", 401);
  if (!/^[0-9a-f-]{36}$/.test(claim.id) || !/^[a-z0-9]{2,4}$/.test(claim.ext)) return error("Bad upload id");
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES) return error("Videos can be up to 2 GB.", 413);
  if (!req.body) return error("Empty upload");

  mkdirSync(UPLOAD_DIR, { recursive: true });
  const file = path.join(UPLOAD_DIR, `${claim.id}.${claim.ext}`);
  let bytes = 0;
  const limit = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctl) {
      bytes += chunk.byteLength;
      if (bytes > MAX_BYTES) ctl.error(new Error("too large"));
      else ctl.enqueue(chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(req.body.pipeThrough(limit) as never), createWriteStream(file, { flags: "wx" }));
  } catch (e) {
    rmSync(file, { force: true });
    return error(e instanceof Error && e.message === "too large" ? "Videos can be up to 2 GB." : "Upload failed. Please try again.", 400);
  }
  return json({ ok: true, bytes });
}
