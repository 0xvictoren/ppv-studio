import "server-only";
import { listTranscripts, type TranscriptSegment } from "./content-db";
import { listVideos, type VideoRow } from "./db";

// Keyword search over published videos: title, description and the worker's transcripts.
// Each hit carries the transcript moments that matched, so a person or agent can jump to them.

const STOP = new Set(
  "the and for are but not you all any can had her was one our out see two way who did its let put say she too use that with have this will your from they know want been good much some time very when come here just like make many over such than them well were what into more only also then there these their would about could which other because how does do is are me my tell explain why where who whose please give show find video videos talk talks anything something someone".split(
    " ",
  ),
);

const MAX_TERMS = 12;

export function terms(q: string): string[] {
  return [...new Set((q.toLowerCase().match(/[a-z0-9][a-z0-9']+/g) ?? []).filter((w) => w.length > 1 && !STOP.has(w)))].slice(0, MAX_TERMS);
}

// Videos and transcripts change rarely; don't reload every transcript for every free search.
const CACHE_MS = 60_000;
const g = globalThis as unknown as { __ppwSearchCorpus?: { at: number; data: Promise<[VideoRow[], Awaited<ReturnType<typeof listTranscripts>>]> } };
function corpus() {
  if (!g.__ppwSearchCorpus || Date.now() - g.__ppwSearchCorpus.at > CACHE_MS) {
    const data = Promise.all([listVideos(), listTranscripts()]);
    g.__ppwSearchCorpus = { at: Date.now(), data };
    data.catch(() => (g.__ppwSearchCorpus = undefined));
  }
  return g.__ppwSearchCorpus.data;
}

const count = (text: string, t: string) => text.split(t).length - 1;

export type SearchHit = { video: VideoRow; score: number; moments: TranscriptSegment[]; hasTranscript: boolean };

export async function searchVideos(q: string, limit = 10): Promise<SearchHit[]> {
  const ts = terms(q);
  if (!ts.length) return [];
  const [videos, transcripts] = await corpus();
  const byVideo = new Map(transcripts.map((t) => [t.video_id, t.segments]));

  const hits: SearchHit[] = [];
  for (const video of videos) {
    const segments = byVideo.get(video.id) ?? [];
    const title = video.title.toLowerCase();
    const desc = video.description.toLowerCase();
    let score = 0;
    const moments: { seg: TranscriptSegment; n: number }[] = [];
    for (const t of ts) {
      score += 5 * count(title, t) + 2 * count(desc, t);
    }
    for (const seg of segments) {
      const text = seg.text.toLowerCase();
      const n = ts.reduce((a, t) => a + count(text, t), 0);
      if (n) moments.push({ seg, n });
    }
    // Transcript matches count with diminishing returns so long videos don't win on length alone.
    score += 3 * Math.log1p(moments.reduce((a, m) => a + m.n, 0));
    // Every term present somewhere beats a few terms repeated.
    const all = `${title} ${desc} ${moments.map((m) => m.seg.text.toLowerCase()).join(" ")}`;
    score *= ts.filter((t) => all.includes(t)).length / ts.length;
    if (score > 0) {
      moments.sort((a, b) => b.n - a.n || a.seg.start - b.seg.start);
      hits.push({ video, score, moments: moments.slice(0, 3).map((m) => m.seg).sort((a, b) => a.start - b.start), hasTranscript: segments.length > 0 });
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
