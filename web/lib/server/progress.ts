import "server-only";
import { costForSeconds } from "../money";
import {
  COMPLETE_RATIO,
  countBits,
  emptyBitmap,
  fromBase64,
  fullBitmap,
  hasBit,
  milestoneIndex,
  PASS_MS,
  setBit,
  toBase64,
  type ProgressDTO,
} from "../progress";
import { getProgress, saveProgress, type ProgressRow, type VideoRow } from "./db";

/** Current window's progress, starting a fresh window when the old one (and any pass) has ended. */
export async function loadProgress(viewer: string, video: Pick<VideoRow, "id" | "duration_seconds">): Promise<ProgressRow | null> {
  const p = await getProgress(viewer, video.id);
  if (!p) return null;
  const now = Date.now();
  const windowOver = new Date(p.window_start).getTime() + PASS_MS < now;
  const passActive = !!p.pass_until && new Date(p.pass_until).getTime() > now;
  if (windowOver && !passActive) return null; // expired: next paid second starts a new window
  return p;
}

export function passActive(p: ProgressRow | null) {
  return !!p?.pass_until && new Date(p.pass_until).getTime() > Date.now();
}

export function toDTO(p: ProgressRow | null, video: Pick<VideoRow, "duration_seconds">, pricePerHour: bigint): ProgressDTO {
  const D = video.duration_seconds;
  const covered = p?.covered_seconds ?? 0;
  const remaining = passActive(p) ? 0n : costForSeconds(pricePerHour, Math.max(0, D - covered));
  return {
    windowStart: p?.window_start ?? null,
    coverage: p?.coverage ?? "",
    coveredSeconds: covered,
    durationSeconds: D,
    completedAt: p?.completed_at ?? null,
    passUntil: p?.pass_until ?? null,
    downloadedAt: p?.downloaded_at ?? null,
    remainingCost: remaining.toString(),
  };
}

/**
 * Merge newly paid seconds reported by the client, accepting at most `maxNewSeconds` new bits
 * (what the accompanying signed receipt actually paid for). Detects completion -> pass.
 * Returns the saved row and whether a settlement milestone was crossed.
 */
export async function applyPaidCoverage(
  viewer: string,
  video: Pick<VideoRow, "id" | "duration_seconds">,
  clientCoverage: string | undefined,
  maxNewSeconds: number,
): Promise<{ progress: ProgressRow; milestone: boolean; added: number }> {
  const D = video.duration_seconds;
  const existing = await loadProgress(viewer, video);
  const nowIso = new Date().toISOString();
  const base = fromBase64(existing?.coverage, D);
  const incoming = fromBase64(clientCoverage, D);
  const before = countBits(base, D);

  let budget = Math.max(0, maxNewSeconds);
  for (let i = 0; i < D && budget > 0; i++) {
    if (hasBit(incoming, i) && !hasBit(base, i)) {
      setBit(base, i);
      budget--;
    }
  }
  const after = countBits(base, D);
  const windowStart = existing?.window_start ?? nowIso;
  const completed = existing?.completed_at ?? (D > 0 && after / D >= COMPLETE_RATIO ? nowIso : null);
  const passUntil =
    existing?.pass_until ?? (completed ? new Date(new Date(windowStart).getTime() + PASS_MS).toISOString() : null);

  const progress = await saveProgress({
    viewer,
    video_id: video.id,
    window_start: windowStart,
    coverage: toBase64(base),
    covered_seconds: after,
    completed_at: completed,
    pass_until: passUntil,
    downloaded_at: existing?.downloaded_at ?? null,
  });
  const milestone = D > 0 && milestoneIndex(after / D) > milestoneIndex(before / D);
  return { progress, milestone, added: after - before };
}

/** After a paid download: every second is paid, and replays/re-downloads are free for 30 days from now. */
export async function grantDownloadPass(viewer: string, video: Pick<VideoRow, "id" | "duration_seconds">): Promise<ProgressRow> {
  const existing = await loadProgress(viewer, video);
  const now = new Date();
  const until = new Date(now.getTime() + PASS_MS);
  const currentPass = existing?.pass_until ? new Date(existing.pass_until) : null;
  return saveProgress({
    viewer,
    video_id: video.id,
    window_start: existing?.window_start ?? now.toISOString(),
    coverage: toBase64(fullBitmap(video.duration_seconds)),
    covered_seconds: video.duration_seconds,
    completed_at: existing?.completed_at ?? now.toISOString(),
    pass_until: (currentPass && currentPass > until ? currentPass : until).toISOString(),
    downloaded_at: now.toISOString(),
  });
}

export { emptyBitmap };
