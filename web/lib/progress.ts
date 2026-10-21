// Shared (client + server) rules for "pay for each second once".
//
// A viewer's progress on a video is a bitmap with one bit per second of the video. A second is
// billed only the first time its bit is set inside the current 30-day window, so resuming or
// re-watching a part you already paid for is free. Once (almost) every second has been paid
// (COMPLETE_RATIO), or the video was bought for download, replays are free until the pass
// ends: 30 days from when the viewer first started the video (or from the download).

export const PASS_DAYS = 30;
export const PASS_MS = PASS_DAYS * 24 * 3600 * 1000;
/** Allows for skipped credits / last-frame rounding. */
export const COMPLETE_RATIO = 0.97;
/** Payment settles on-chain as soon as paid progress crosses each of these. */
export const MILESTONES = [0.1, 0.25, 0.5, 0.75, 1] as const;

export function emptyBitmap(durationSeconds: number): Uint8Array {
  return new Uint8Array(Math.ceil(Math.max(1, durationSeconds) / 8));
}

export function fullBitmap(durationSeconds: number): Uint8Array {
  const b = emptyBitmap(durationSeconds);
  for (let i = 0; i < durationSeconds; i++) b[i >> 3] |= 1 << (i & 7);
  return b;
}

export function hasBit(b: Uint8Array, i: number) {
  return (b[i >> 3] & (1 << (i & 7))) !== 0;
}

export function setBit(b: Uint8Array, i: number) {
  b[i >> 3] |= 1 << (i & 7);
}

export function countBits(b: Uint8Array, limit = b.length * 8): number {
  let n = 0;
  for (let i = 0; i < limit; i++) if (hasBit(b, i)) n++;
  return n;
}

export function toBase64(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}

export function fromBase64(s: string | null | undefined, durationSeconds: number): Uint8Array {
  const out = emptyBitmap(durationSeconds);
  if (!s) return out;
  try {
    const raw = atob(s);
    for (let i = 0; i < Math.min(raw.length, out.length); i++) out[i] = raw.charCodeAt(i);
  } catch {
    /* corrupt: treat as empty */
  }
  return out;
}

/** Highest milestone index reached for a given ratio (-1 = none). */
export function milestoneIndex(ratio: number): number {
  let idx = -1;
  MILESTONES.forEach((m, i) => {
    if (ratio >= m - 1e-9 || (m === 1 && ratio >= COMPLETE_RATIO)) idx = i;
  });
  return idx;
}

/** Public shape served to the viewer's own client. */
export type ProgressDTO = {
  windowStart: string | null;
  coverage: string;
  coveredSeconds: number;
  durationSeconds: number;
  completedAt: string | null;
  passUntil: string | null;
  downloadedAt: string | null;
  /** What it costs to buy the rest of the video now (download price), in base units. */
  remainingCost: string;
};
