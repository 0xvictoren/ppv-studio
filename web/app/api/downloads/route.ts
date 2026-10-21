import type { Hex } from "viem";
import { readPpw } from "@/lib/server/chain";
import { getVideo } from "@/lib/server/db";
import { error, json } from "@/lib/server/http";
import { downloadable, storageRef } from "@/lib/server/media";
import { presignRead } from "@/lib/server/r2";
import { grantDownloadPass, loadProgress, passActive } from "@/lib/server/progress";
import { ReceiptError, verifyAndStoreReceipt, type RawReceipt } from "@/lib/server/receipts";
import { runSettlement } from "@/lib/server/settle";
import { signMedia } from "@/lib/server/upload-token";
import { authViewer } from "@/lib/server/viewer-auth";
import { costForSeconds } from "@/lib/money";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DOWNLOAD_TTL_MS = 30 * 60 * 1000;

/**
 * POST { viewer, videoId, receipt?, signature? }
 * In-app download (saved inside PayPerWatch for offline viewing, like YouTube).
 *  - With an active 30-day pass (watched to the end, or downloaded before): free.
 *  - Otherwise the signed receipt must pay for every second not yet paid for (the rest of the
 *    full-watch price). It's settled on-chain right away, then a 30-day pass is granted.
 * Returns a short-lived link the app streams into its offline library.
 */
export async function POST(req: Request) {
  const body = (await req.json()) as { viewer: string; videoId: string; receipt?: RawReceipt; signature?: Hex };
  const { viewer, videoId } = body;
  if (!(await authViewer(req, viewer))) return error("Not authorized", 401);
  const video = await getVideo(videoId);
  if (!video) return error("Video not found", 404);
  if (!video.active) return error("This video has been unpublished.", 410);
  if (!downloadable(video)) return error("This video streams only and can't be saved offline.", 422);

  let progress = await loadProgress(viewer, video);
  if (!passActive(progress)) {
    const [, onchainPrice] = await readPpw<readonly [string, bigint, boolean]>("videos", [video.id]);
    const price = onchainPrice > 0n ? onchainPrice : BigInt(video.price_per_hour);
    const remaining = costForSeconds(price, Math.max(0, video.duration_seconds - (progress?.covered_seconds ?? 0)));
    if (remaining > 0n) {
      if (!body.receipt || !body.signature) return json({ needsPayment: true, amount: remaining.toString() }, { status: 402 });
      let verified;
      try {
        verified = await verifyAndStoreReceipt(body.receipt, body.signature, { videoId: video.id });
      } catch (e) {
        if (e instanceof ReceiptError) return error(e.message, e.status);
        throw e;
      }
      const { receipt, previous } = verified;
      if (receipt.viewer.toLowerCase() !== viewer.toLowerCase() || receipt.creator.toLowerCase() !== video.creator) {
        return error("Receipt doesn't match this video", 400);
      }
      if (receipt.cumulativeAmount - previous < remaining) return error("The payment doesn't cover the rest of this video.", 402);

      // Settle now so the download is paid for on-chain before the file is released.
      const lane = { viewer: receipt.viewer, creator: receipt.creator, referrer: receipt.referrer };
      await runSettlement({ only: [lane] });
      const settled = await readPpw<bigint>("settled", [lane.viewer, lane.creator, lane.referrer]);
      if (settled < receipt.cumulativeAmount) {
        return error("Not enough USDC in your PayPerWatch balance to download. Add funds and try again.", 402);
      }
    }
    progress = await grantDownloadPass(viewer, video);
  }

  const ref = storageRef(video);
  if (ref.kind === "r2") return json({ url: await presignRead(ref.key, DOWNLOAD_TTL_MS / 1000), passUntil: progress?.pass_until });
  const file = ref.kind === "local" ? ref.file : `remote:${video.id}`;
  const token = signMedia({ kind: "download", file, viewer: viewer.toLowerCase(), exp: Date.now() + DOWNLOAD_TTL_MS });
  return json({ url: `/api/downloads/file?t=${encodeURIComponent(token)}`, passUntil: progress?.pass_until });
}
