import { costForSeconds } from "@/lib/money";
import { readPpw } from "@/lib/server/chain";
import { getHls } from "@/lib/server/content-db";
import { getVideo } from "@/lib/server/db";
import { spendableBalance } from "@/lib/server/funds";
import { error, json } from "@/lib/server/http";
import { storageRef } from "@/lib/server/media";
import { presignRead } from "@/lib/server/r2";
import { loadProgress, passActive } from "@/lib/server/progress";
import { signMedia } from "@/lib/server/upload-token";
import { authViewer } from "@/lib/server/viewer-auth";

export const dynamic = "force-dynamic";

/** Whole-file links expire quickly; the player renews them while the viewer keeps paying. */
const STREAM_TTL_MS = 15 * 60 * 1000;
/** Encrypted HLS: the per-segment keys are gated by payment, so the playlist link can last. */
const HLS_TTL_MS = 3 * 60 * 60 * 1000;
/** Without a pass, the viewer must be able to pay for at least this much right now. */
const MIN_FUNDED_SECONDS = 120;

/**
 * POST { viewer, videoId } -> { url, expiresIn }. Private uploads (local disk, R2) play as encrypted
 * HLS once the worker has packaged them (only paid-for segments can be decrypted), and until then
 * through short-lived whole-file links. Requires a free-replay pass, or a session key (so the player can bill) backed
 * by enough unspent PayPerWatch balance: an authorized key alone, with nothing deposited, gets nothing.
 */
export async function POST(req: Request) {
  const { viewer, videoId } = (await req.json()) as { viewer: string; videoId: string };
  if (typeof viewer !== "string" || typeof videoId !== "string") return error("Bad request");
  const how = await authViewer(req, viewer);
  if (!how) return error("Not authorized", 401);
  const video = await getVideo(videoId);
  if (!video) return error("Video not found", 404);
  const ref = storageRef(video);
  if (ref.kind === "remote") return json({ url: ref.url, expiresIn: null });
  if (!passActive(await loadProgress(viewer, video))) {
    if (how !== "session-key") return error("Add funds to start watching.", 402);
    const [, onchainPrice] = await readPpw<readonly [string, bigint, boolean]>("videos", [video.id]);
    const price = onchainPrice > 0n ? onchainPrice : BigInt(video.price_per_hour);
    if ((await spendableBalance(viewer)) < costForSeconds(price, MIN_FUNDED_SECONDS)) return error("Add funds to start watching.", 402);
  }
  const hls = await getHls(video.content_cid);
  if (hls?.status === "ready") {
    const token = signMedia({ kind: "hls", file: video.content_cid, viewer: viewer.toLowerCase(), exp: Date.now() + HLS_TTL_MS });
    return json({ url: `/api/hls/${video.id}/index.m3u8?t=${encodeURIComponent(token)}`, expiresIn: HLS_TTL_MS / 1000 });
  }
  const expiresIn = STREAM_TTL_MS / 1000;
  if (ref.kind === "r2") return json({ url: await presignRead(ref.key, expiresIn), expiresIn });
  const token = signMedia({ kind: "stream", file: ref.file, viewer: viewer.toLowerCase(), exp: Date.now() + STREAM_TTL_MS });
  return json({ url: `/media/${ref.file}?t=${encodeURIComponent(token)}`, expiresIn });
}
