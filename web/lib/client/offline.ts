"use client";

// In-app offline library (like YouTube downloads): videos bought for download are saved in the
// browser's IndexedDB and play only inside PayPerWatch, for as long as the 30-day pass lasts.

export type OfflineVideo = {
  videoId: string;
  viewer: string;
  title: string;
  category: string;
  thumbnail: string | null;
  durationSeconds: number;
  passUntil: string;
  savedAt: string;
  bytes: number;
  blob: Blob;
};

const DB = "ppw-offline";
const STORE = "videos";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "videoId" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const saveOffline = (v: OfflineVideo) => tx("readwrite", (s) => s.put(v));
export const getOffline = (videoId: string) => tx<OfflineVideo | undefined>("readonly", (s) => s.get(videoId.toLowerCase()));
export const deleteOffline = (videoId: string) => tx("readwrite", (s) => s.delete(videoId.toLowerCase()));

/** All saved videos; anything whose pass has ended is removed. Returns [kept, expiredTitles]. */
export async function listOffline(): Promise<[OfflineVideo[], string[]]> {
  const all = await tx<OfflineVideo[]>("readonly", (s) => s.getAll());
  const now = Date.now();
  const kept: OfflineVideo[] = [];
  const expired: string[] = [];
  for (const v of all) {
    if (new Date(v.passUntil).getTime() > now) kept.push(v);
    else {
      expired.push(v.title);
      await deleteOffline(v.videoId);
    }
  }
  return [kept.sort((a, b) => b.savedAt.localeCompare(a.savedAt)), expired];
}

/** Stream a download into memory with progress, then return it as a Blob. */
export async function fetchWithProgress(url: string, onProgress: (pct: number) => void): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error("Download failed. Please try again.");
  const total = Number(res.headers.get("content-length") ?? 0);
  const reader = res.body.getReader();
  const chunks: BlobPart[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    if (total) onProgress(Math.round((received / total) * 100));
  }
  return new Blob(chunks, { type: res.headers.get("content-type") ?? "video/mp4" });
}
