import "server-only";
import { createHmac } from "node:crypto";
import { costForSeconds } from "../money";
import { fromBase64, hasBit } from "../progress";
import { readPpw } from "./chain";
import { addHlsGrant, getHlsGrants, type HlsRow } from "./content-db";
import type { VideoRow } from "./db";
import { spendableBalance } from "./funds";
import { loadProgress, passActive } from "./progress";
import { presignRead } from "./r2";

// Encrypted streaming. The review worker packages each published video as HLS with AES-128, every
// segment under its own key (HMAC of the video's master key and the segment number). Segments are
// useless without keys, so they can be served openly; /api/hls/[id]/key/[seg] hands out a key only
// for seconds the viewer has paid for, plus a small unpaid lookahead so playback and seeking are
// smooth. Downloading every segment gets a ripper nothing beyond that lookahead.

/** Unpaid seconds a viewer may hold keys for at once (the player buffers ~30s ahead). */
const LOOKAHEAD_SECONDS = 60;
/** ...counted over this window, so lookahead skipped past by a seek frees up again. */
const LOOKAHEAD_WINDOW_MS = 10 * 60 * 1000;
/** Lifetime cap on unpaid keyed time per viewer and video: the most a non-payer can ever decrypt. */
const unpaidLifetimeCap = (duration: number) => Math.max(60, Math.round(duration * 0.1));
/** Signed segment URLs (R2) last a while: the segments are encrypted, the keys are what's gated. */
const SEGMENT_URL_TTL_S = 6 * 60 * 60;

export const segmentKey = (masterHex: string, seg: number) =>
  createHmac("sha256", Buffer.from(masterHex, "hex")).update(`seg:${seg}`).digest().subarray(0, 16);

const ivHex = (seg: number) => seg.toString(16).padStart(32, "0");

/** Start second and duration of every segment. */
export function segmentTimes(hls: Pick<HlsRow, "segments">): { start: number; duration: number }[] {
  let t = 0;
  return hls.segments.map((s) => {
    const r = { start: t, duration: s.duration };
    t += s.duration;
    return r;
  });
}

export const hlsSegmentPath = (id: string, name: string) => `hls/${id}/${name}`;

/** The VOD playlist for one viewer: segment URLs plus per-segment key URIs carrying their token. */
export async function renderPlaylist(hls: HlsRow, videoId: string, token: string): Promise<string> {
  const lines = ["#EXTM3U", "#EXT-X-VERSION:3", `#EXT-X-TARGETDURATION:${Math.ceil(hls.target_duration)}`, "#EXT-X-MEDIA-SEQUENCE:0", "#EXT-X-PLAYLIST-TYPE:VOD"];
  const t = encodeURIComponent(token);
  const urls = await Promise.all(
    hls.segments.map((s) =>
      hls.storage === "r2" ? presignRead(hlsSegmentPath(hls.id, s.name), SEGMENT_URL_TTL_S) : Promise.resolve(`/media/hls/${encodeURIComponent(hls.id)}/${s.name}`),
    ),
  );
  hls.segments.forEach((s, i) => {
    lines.push(`#EXT-X-KEY:METHOD=AES-128,URI="/api/hls/${videoId}/key/${i}?t=${t}",IV=0x${ivHex(i)}`);
    lines.push(`#EXTINF:${s.duration.toFixed(3)},`, urls[i]);
  });
  lines.push("#EXT-X-ENDLIST", "");
  return lines.join("\n");
}

export type KeyDecision = { ok: true; key: Buffer } | { ok: false; status: number; error: string };

/**
 * May `viewer` decrypt segment `seg`? Yes with a pass, for seconds already paid, for a key they
 * were given before, or within the unpaid lookahead (which also needs a funded balance).
 */
export async function authorizeSegmentKey(viewer: string, video: VideoRow, hls: HlsRow, seg: number): Promise<KeyDecision> {
  const times = segmentTimes(hls);
  if (!Number.isInteger(seg) || seg < 0 || seg >= times.length) return { ok: false, status: 404, error: "No such segment" };
  const key = segmentKey(hls.key, seg);
  const progress = await loadProgress(viewer, video);
  if (passActive(progress)) return { ok: true, key };

  const coverage = fromBase64(progress?.coverage, video.duration_seconds);
  const paid = ({ start, duration }: { start: number; duration: number }) => {
    const a = Math.floor(start);
    const b = Math.min(video.duration_seconds, Math.ceil(start + duration));
    let n = 0;
    for (let i = a; i < b; i++) if (hasBit(coverage, i)) n++;
    return b <= a || n / (b - a) >= 0.8; // the meter rounds; most of the segment paid counts
  };
  if (paid(times[seg])) return { ok: true, key };

  const grants = (await getHlsGrants(viewer, video.id))?.grants ?? {};
  if (grants[String(seg)] !== undefined) return { ok: true, key };

  const now = Date.now();
  let recent = 0;
  let lifetime = 0;
  for (const [s, at] of Object.entries(grants)) {
    const t = times[Number(s)];
    if (!t || paid(t)) continue;
    lifetime += t.duration;
    if (now - at < LOOKAHEAD_WINDOW_MS) recent += t.duration;
  }
  if (recent >= LOOKAHEAD_SECONDS) return { ok: false, status: 402, error: "Keep paying to keep watching." };
  if (lifetime + times[seg].duration > unpaidLifetimeCap(video.duration_seconds)) return { ok: false, status: 402, error: "Add funds to keep watching." };

  const [, onchainPrice] = await readPpw<readonly [string, bigint, boolean]>("videos", [video.id]);
  const price = onchainPrice > 0n ? onchainPrice : BigInt(video.price_per_hour);
  if ((await spendableBalance(viewer)) < costForSeconds(price, LOOKAHEAD_SECONDS)) return { ok: false, status: 402, error: "Add funds to keep watching." };

  await addHlsGrant(viewer, video.id, seg, now);
  return { ok: true, key };
}
