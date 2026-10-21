"use client";

import { getAddress, isAddress, type Address } from "viem";
import { env } from "../env";

// Referral attribution, first click wins: the first valid ?ref= link someone opens for a video
// is remembered for 30 days, so a later link can't take over the attribution.

const TTL_MS = 30 * 24 * 3600 * 1000;
const key = (videoId: string) => `ppw:ref:${env.chainId}:${env.ppwAddress.toLowerCase()}:${videoId.toLowerCase()}`;

export function captureReferral(videoId: string, ref: string | null | undefined) {
  if (!ref || !isAddress(ref)) return;
  try {
    const existing = JSON.parse(localStorage.getItem(key(videoId)) ?? "null") as { referrer: string; at: number } | null;
    if (existing && Date.now() - existing.at < TTL_MS) return;
    localStorage.setItem(key(videoId), JSON.stringify({ referrer: getAddress(ref), at: Date.now() }));
  } catch {
    /* storage unavailable: attribution lasts for this page view only */
  }
}

export function storedReferral(videoId: string): Address | null {
  try {
    const v = JSON.parse(localStorage.getItem(key(videoId)) ?? "null") as { referrer: Address; at: number } | null;
    return v && Date.now() - v.at < TTL_MS ? v.referrer : null;
  } catch {
    return null;
  }
}
