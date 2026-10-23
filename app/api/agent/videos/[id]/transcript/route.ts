import { randomUUID } from "node:crypto";
import { agentApiEnabled, env } from "@/lib/env";
import { creditCreator, requirePayment, transcriptPrice } from "@/lib/server/agent-pay";
import { getIndexByVideo } from "@/lib/server/content-db";
import { getVideo } from "@/lib/server/db";
import { error, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET (x402, paid) -> the video's full transcript with timestamps.
 * Unpaid requests get 402 with Circle Gateway payment requirements. The price is what a person
 * pays to watch the whole video; the creator is paid through PayPerWatch settlement.
 */
export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  if (!agentApiEnabled) return error("The agent API isn't available on this network yet.", 404);
  const params = await props.params;
  // Check everything before taking payment: the middleware settles before we respond.
  const video = await getVideo(params.id);
  if (!video || !video.active) return error("Video not found", 404);
  const entry = await getIndexByVideo(video.id);
  if (!entry?.segments.length) return error("This video has no transcript yet.", 404);

  const paid = await requirePayment(req, transcriptPrice(video));
  if ("response" in paid) return paid.response;

  const purchaseId = paid.payment.transaction || randomUUID();
  try {
    await creditCreator(video, paid.payment, purchaseId);
  } catch (e) {
    // The agent has paid, so deliver anyway. If the purchase was recorded, the creator's next
    // agent receipt (a cumulative total) includes it.
    console.error(`[agent] couldn't credit creator for purchase ${purchaseId}`, e);
  }
  return json(
    {
      video: { id: video.id, title: video.title, description: video.description, creator: video.creator, durationSeconds: video.duration_seconds, watchUrl: `${env.appUrl}/watch/${video.id}` },
      transcript: entry.transcript,
      segments: entry.segments,
      payment: { amount: paid.payment.amount, network: paid.payment.network, transaction: paid.payment.transaction ?? null },
    },
    { headers: paid.headers },
  );
}
