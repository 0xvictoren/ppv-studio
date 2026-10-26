import { randomUUID } from "node:crypto";
import { agentApiEnabled, env } from "@/lib/env";
import { formatUsdc } from "@/lib/money";
import { creditCreator, requirePayment, transcriptPrice } from "@/lib/server/agent-pay";
import { getIndexByVideo } from "@/lib/server/content-db";
import { error, json } from "@/lib/server/http";
import { searchVideos } from "@/lib/server/search";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The one endpoint to give an agent. GET ?q=<question> (or POST {"q": "..."}), paid over x402:
 * finds the video that best answers the question and sells its full timestamped transcript, with
 * the moments that matched. The 402 names the price (what a person pays to watch that whole video)
 * and accepts a Circle Gateway balance on any supported chain. Nothing relevant: 404, no charge.
 */
async function handle(req: Request) {
  if (!agentApiEnabled) return error("The agent API isn't available on this network yet.", 404);
  const url = new URL(req.url);
  let q = url.searchParams.get("q") ?? url.searchParams.get("question") ?? "";
  if (!q && req.method === "POST") {
    const body = (await req.json().catch(() => ({}))) as { q?: unknown; question?: unknown };
    q = String(body.q ?? body.question ?? "");
  }
  q = q.trim().slice(0, 300);
  if (!q) return error('Ask a question: ?q=how does private credit work onchain (or POST {"q": "..."})');

  // Only videos with a transcript can be sold. Decide before taking payment.
  const hits = (await searchVideos(q, 5)).filter((h) => h.hasTranscript);
  const best = hits[0];
  if (!best) return json({ query: q, answer: null, message: "Nothing on PayPerWatch covers this yet. You weren't charged." }, { status: 404 });
  const entry = await getIndexByVideo(best.video.id);
  if (!entry?.segments.length) return json({ query: q, answer: null, message: "Nothing on PayPerWatch covers this yet. You weren't charged." }, { status: 404 });

  const paid = await requirePayment(req, transcriptPrice(best.video));
  if ("response" in paid) return paid.response;

  const purchaseId = paid.payment.transaction || randomUUID();
  try {
    await creditCreator(best.video, paid.payment, purchaseId);
  } catch (e) {
    // Paid already, so deliver. A recorded purchase is included in the creator's next cumulative receipt.
    console.error(`[agent] couldn't credit creator for purchase ${purchaseId}`, e);
  }
  const v = best.video;
  return json(
    {
      query: q,
      answer: {
        video: { id: v.id, title: v.title, description: v.description, creator: v.creator, durationSeconds: v.duration_seconds, watchUrl: `${env.appUrl}/watch/${v.id}` },
        // Where the question is answered, so the agent can quote or point the user to the right second.
        moments: best.moments.map((m) => ({ start: m.start, end: m.end, text: m.text })),
        transcript: entry.transcript,
        segments: entry.segments,
      },
      // Other matches, each buyable on its own.
      alsoRelevant: hits.slice(1).map((h) => ({
        id: h.video.id,
        title: h.video.title,
        moments: h.moments.map((m) => ({ start: m.start, text: m.text })),
        transcript: { url: `${env.appUrl}/api/agent/videos/${h.video.id}/transcript`, price: formatUsdc(transcriptPrice(h.video), { decimals: 6 }) },
      })),
      payment: { amount: paid.payment.amount, network: paid.payment.network, transaction: paid.payment.transaction ?? null },
    },
    { headers: paid.headers },
  );
}

export const GET = handle;
export const POST = handle;
