import { env } from "@/lib/env";
import { formatUsdc } from "@/lib/money";
import { transcriptPrice } from "@/lib/server/agent-pay";
import { error, json } from "@/lib/server/http";
import { searchVideos } from "@/lib/server/search";

export const dynamic = "force-dynamic";

// Free endpoint, so cap how hard one client can hit it: 30 searches a minute per IP. Best effort
// (per server instance), enough to stop casual scraping of every transcript excerpt.
const PER_MINUTE = 30;
const g = globalThis as unknown as { __ppwSearchHits?: Map<string, number[]> };
function limited(req: Request): boolean {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
  const hits = (g.__ppwSearchHits ??= new Map<string, number[]>());
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 10_000) hits.clear();
  return recent.length > PER_MINUTE;
}

/**
 * GET ?q=fibonacci retracement&limit=10 (free) -> videos matching the query, with the transcript
 * moments that matched and the price of the full transcript at /api/agent/videos/{id}/transcript.
 */
export async function GET(req: Request) {
  if (limited(req)) return json({ error: "Too many searches. Try again in a minute." }, { status: 429, headers: { "retry-after": "60" } });
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
