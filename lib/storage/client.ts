"use client";

import { api } from "../client/api";
import { SAMPLE_VIDEOS } from "../samples";

// Storage adapter. The provider (local | r2 | supabase | livepeer | pinata) is chosen server-side by
// NEXT_PUBLIC_STORAGE_PROVIDER; the browser uploads directly to it.

/** uploadRef: the server's signed proof that it issued this location (see /api/storage/upload). */
export type UploadResult = { contentCid: string; playbackUrl: string; uploadRef?: string };

type Target =
  | { provider: "local" | "r2" | "supabase" | "livepeer"; uploadUrl: string; contentId: string; playbackUrl: string; contentType?: string; uploadRef: string }
  | { provider: "pinata"; uploadUrl: string; gateway: string }
  | { provider: "mock" };

function xhr(method: string, url: string, body: Document | XMLHttpRequestBodyInit, onProgress: (p: number) => void, contentType?: string) {
  return new Promise<string>((resolve, reject) => {
    const req = new XMLHttpRequest();
    req.open(method, url);
    if (contentType) req.setRequestHeader("content-type", contentType);
    req.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    req.onload = () => (req.status >= 200 && req.status < 300 ? resolve(req.responseText) : reject(new Error(`Upload failed (${req.status})`)));
    req.onerror = () => reject(new Error("Upload failed. Check your connection and try again."));
    req.send(body);
  });
}

async function fingerprint(file: File): Promise<string> {
  const head = await file.slice(0, 4 * 1024 * 1024).arrayBuffer();
  const meta = new TextEncoder().encode(`${file.name}:${file.size}:${file.lastModified}`);
  const buf = new Uint8Array(head.byteLength + meta.byteLength);
  buf.set(new Uint8Array(head));
  buf.set(meta, head.byteLength);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function uploadVideo(file: File, onProgress: (pct: number) => void): Promise<UploadResult> {
  const target = await api<Target>("/api/storage/upload", { method: "POST", json: { name: file.name, type: file.type } });

  if (target.provider === "local" || target.provider === "r2" || target.provider === "supabase" || target.provider === "livepeer") {
    // R2 signs the Content-Type into the URL, so send exactly the one the server chose.
    await xhr("PUT", target.uploadUrl, file, onProgress, target.contentType ?? (file.type || "video/mp4"));
    return { contentCid: target.contentId, playbackUrl: target.playbackUrl, uploadRef: target.uploadRef };
  }

  if (target.provider === "pinata") {
    const form = new FormData();
    form.append("network", "public");
    form.append("file", file);
    const text = await xhr("POST", target.uploadUrl, form, onProgress);
    const cid = (JSON.parse(text) as { data: { cid: string } }).data.cid;
    return { contentCid: cid, playbackUrl: `https://${target.gateway}/ipfs/${cid}` };
  }

  // Mock (automated tests only): simulate the upload; the file plays from a blob URL.
  for (let p = 0; p <= 100; p += 10) {
    onProgress(p);
    await new Promise((r) => setTimeout(r, 120));
  }
  return { contentCid: `mock-${await fingerprint(file)}`, playbackUrl: URL.createObjectURL(file) };
}

export const FALLBACK_PLAYBACK = SAMPLE_VIDEOS[0].playbackUrl;

/** Read duration and grab a few candidate thumbnail frames (JPEG data URLs). */
export async function inspectVideo(file: File, frames = 3): Promise<{ duration: number; thumbnails: string[] }> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("That file doesn't look like a playable video."));
    });
    const duration = video.duration;
    const thumbnails: string[] = [];
    const canvas = document.createElement("canvas");
    const w = 480;
    canvas.width = w;
    canvas.height = Math.round((video.videoHeight / video.videoWidth) * w) || 270;
    const ctx = canvas.getContext("2d")!;
    for (let i = 0; i < frames; i++) {
      video.currentTime = Math.max(0.1, (duration * (i + 1)) / (frames + 1));
      await new Promise<void>((resolve) => (video.onseeked = () => resolve()));
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      thumbnails.push(canvas.toDataURL("image/jpeg", 0.72));
    }
    return { duration, thumbnails };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** A creator's own thumbnail image, resized to fit 1280x720 and re-encoded as JPEG. */
export async function imageToThumbnail(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Choose a JPG, PNG or WebP image.");
  if (file.size > 15 * 1024 * 1024) throw new Error("That image is over 15 MB. Try a smaller one.");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("That image couldn't be read."));
      i.src = url;
    });
    const scale = Math.min(1, 1280 / img.naturalWidth, 720 / img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}
