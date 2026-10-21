import "server-only";
import type { VideoRow, WatchSessionRow } from "./db";

// Watch-based rating (0–5). No buttons to click: a video is rated by how people actually watch it.
//
// Per paying viewer, from their total watch time t on a video of length D:
//   completion c = min(1, t / D)                 how far they got
//   rewatch    r = min(1, max(0, t / D - 1) / 2)  coming back: full credit after two extra watches
//   score      = 1 + 3c + r                       1 = sampled it, 4 = watched to the end, 5 = keeps coming back
//
// The video's rating is the Bayesian average of viewer scores with a prior of PRIOR_SCORE
// weighted as PRIOR_WEIGHT viewers, so one enthusiastic viewer can't make a video 5 stars.
// Only server-verified watch time counts: paid seconds (credited from signed receipts) plus
// free replays, which only exist for viewers who already paid for those seconds or hold a
// 30-day pass, and are credited by wall clock. That makes ratings costly to game.

const PRIOR_SCORE = 3;
const PRIOR_WEIGHT = 3;

export type Rating = { rating: number | null; raters: number; completionRate: number; rewatchRate: number; plays: number };

export function rateVideo(video: Pick<VideoRow, "duration_seconds">, sessions: WatchSessionRow[]): Rating {
  const watched = (s: WatchSessionRow) => s.seconds + (s.free_seconds ?? 0);
  const paid = sessions.filter((s) => watched(s) > 0 && (BigInt(s.amount) > 0n || (s.free_seconds ?? 0) > 0));
  const D = video.duration_seconds;
  const perViewer = new Map<string, number>();
  for (const s of paid) perViewer.set(s.viewer, (perViewer.get(s.viewer) ?? 0) + watched(s));
  const n = perViewer.size;
  if (!D || n === 0) return { rating: null, raters: n, completionRate: 0, rewatchRate: 0, plays: paid.length };

  let total = 0;
  let completed = 0;
  let rewatched = 0;
  for (const t of perViewer.values()) {
    const ratio = t / D;
    const c = Math.min(1, ratio);
    const r = Math.min(1, Math.max(0, ratio - 1) / 2);
    total += 1 + 3 * c + r;
    if (ratio >= 0.9) completed++;
    if (ratio >= 1.8) rewatched++;
  }
  const rating = (PRIOR_SCORE * PRIOR_WEIGHT + total) / (PRIOR_WEIGHT + n);
  return {
    rating: Math.round(rating * 10) / 10,
    raters: n,
    completionRate: completed / n,
    rewatchRate: rewatched / n,
    plays: paid.length,
  };
}
