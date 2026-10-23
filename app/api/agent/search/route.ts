import { env } from "@/lib/env";
import { formatUsdc } from "@/lib/money";
import { transcriptPrice } from "@/lib/server/agent-pay";
import { error, json } from "@/lib/server/http";
import { searchVideos } from "@/lib/server/search";

export const dynamic = "force-dynamic";

/**
 * GET ?q=fibonacci retracement&limit=10 (free) -> videos matching the query, with the transcript
 * moments that matched and the price of the full transcript at /api/agent/videos/{id}/transcript.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim().slice(0, 200);
  if (!q) return error("Pass a query: ?q=fibonacci");
  const limit = Math.min(25, Math.max(1, Number(url.searchParams.get("limit")) || 10));
  const hits = await searchVideos(q, limit);
  return json({
    query: q,
    results: hits.map(({ video, score, moments, hasTranscript }) => {
      const price = transcriptPrice(video);
      return {
        id: video.id,
        title: video.title,
        description: video.description.slice(0, 500),
        category: video.category,
        creator: video.creator,
        durationSeconds: video.duration_seconds,
        relevance: Math.round(score * 100) / 100,
        moments: moments.map((m) => ({ start: m.start, end: m.end, text: m.text })),
        watchUrl: `${env.appUrl}/watch/${video.id}`,
        transcript: hasTranscript
          ? { url: `${env.appUrl}/api/agent/videos/${video.id}/transcript`, price: formatUsdc(price, { decimals: 6 }), priceUnits: price.toString() }
          : null,
      };
    }),
  });
}
