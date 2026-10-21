"use client";

import Hls from "hls.js";
import { forwardRef, useEffect, useImperativeHandle, useRef, type KeyboardEvent, type ReactNode } from "react";
import { FALLBACK_PLAYBACK } from "@/lib/storage/client";

/**
 * Video element with HLS support (hls.js where the browser lacks native HLS) and keyboard
 * controls on the focusable wrapper: Space/K play-pause, ←/→ seek 5s, M mute, F fullscreen.
 */
export const Player = forwardRef<
  HTMLVideoElement,
  { src: string | null; poster?: string | null; title: string; onPlayAttempt?: (e: Event) => void; overlay?: ReactNode }
>(function Player({ src, poster, title, onPlayAttempt, overlay }, ref) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => videoRef.current!, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (!src) {
      v.removeAttribute("src");
      v.load();
      return;
    }
    // Keep the playhead when the (short-lived) stream link is refreshed.
    const resumeAt = v.currentTime;
    const wasPlaying = !v.paused;
    const restore = () => {
      if (resumeAt > 0) v.currentTime = resumeAt;
      if (wasPlaying) void v.play().catch(() => {});
    };
    v.addEventListener("loadedmetadata", restore, { once: true });
    let hls: Hls | null = null;
    if (src.endsWith(".m3u8") && !v.canPlayType("application/vnd.apple.mpegurl") && Hls.isSupported()) {
      hls = new Hls();
      hls.loadSource(src);
      hls.attachMedia(v);
    } else {
      v.src = src;
    }
    // Mock uploads use blob: URLs that only exist in the uploading tab.
    const onError = () => {
      if (src.startsWith("blob:") && v.src !== FALLBACK_PLAYBACK) v.src = FALLBACK_PLAYBACK;
    };
    v.addEventListener("error", onError);
    return () => {
      v.removeEventListener("error", onError);
      v.removeEventListener("loadedmetadata", restore);
      hls?.destroy();
    };
  }, [src]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !onPlayAttempt) return;
    v.addEventListener("play", onPlayAttempt);
    return () => v.removeEventListener("play", onPlayAttempt);
  }, [onPlayAttempt]);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const v = videoRef.current;
    if (!v || (e.target as HTMLElement).tagName === "BUTTON") return;
    const k = e.key.toLowerCase();
    if (k === " " || k === "k") {
      e.preventDefault();
      if (v.paused) void v.play();
      else v.pause();
    } else if (k === "arrowright") {
      v.currentTime = Math.min(v.duration || Infinity, v.currentTime + 5);
    } else if (k === "arrowleft") {
      v.currentTime = Math.max(0, v.currentTime - 5);
    } else if (k === "m") {
      v.muted = !v.muted;
    } else if (k === "f") {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void wrapRef.current?.requestFullscreen();
    }
  };

  return (
    <div
      ref={wrapRef}
      tabIndex={0}
      onKeyDown={onKey}
      onContextMenu={(e) => e.preventDefault()}
      role="region"
      aria-label={`Video player: ${title}. Space to play or pause, arrow keys to seek, M to mute, F for fullscreen.`}
      className="relative aspect-video w-full overflow-hidden rounded-lg border bg-black"
    >
      <video
        ref={videoRef}
        className="size-full"
        controls
        // Watch in the app only: no browser download button or "Save video as".
        controlsList="nodownload"
        playsInline
        preload="metadata"
        poster={poster ?? undefined}
        aria-label={title}
      />
      {overlay}
    </div>
  );
});
