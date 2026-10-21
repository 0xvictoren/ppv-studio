import "server-only";
import type { VideoRow } from "./db";

/** Where a video's bytes live. */
export type StorageRef = { kind: "local"; file: string } | { kind: "r2"; key: string } | { kind: "remote"; url: string };

export function storageRef(video: Pick<VideoRow, "playback_url">): StorageRef {
  const local = video.playback_url.match(/^\/media\/([0-9a-f-]{36}\.[a-z0-9]{2,4})$/);
  if (local) return { kind: "local", file: local[1] };
  if (video.playback_url.startsWith("r2:")) return { kind: "r2", key: video.playback_url.slice(3) };
  return { kind: "remote", url: video.playback_url };
}

/** Local uploads are served by /media/<file>. */
export function localMediaFile(video: Pick<VideoRow, "playback_url">): string | null {
  const ref = storageRef(video);
  return ref.kind === "local" ? ref.file : null;
}

/** Private storage (local disk, R2) needs a signed, short-lived link to play. */
export function needsSignedPlayback(playbackUrl: string) {
  return playbackUrl.startsWith("/media/") || playbackUrl.startsWith("r2:");
}

/** Downloads need a single progressive file; HLS streams can't be saved as one. */
export function downloadable(video: Pick<VideoRow, "playback_url">) {
  return !video.playback_url.endsWith(".m3u8");
}
