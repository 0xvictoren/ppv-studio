"use client";

import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import type { PpwEvent } from "../contract";
import { api } from "./api";
import { readPpw, usdcBalance } from "./ppw";

export type VideoDTO = {
  id: string;
  creator: string;
  title: string;
  description: string;
  category: string;
  referrals_enabled: boolean;
  thumbnail_url: string | null;
  content_cid: string;
  playback_url: string;
  price_per_hour: string;
  duration_seconds: number;
  active: boolean;
  register_tx: string | null;
  created_at: string;
  views: number;
  watch_seconds: number;
  rating: number | null;
  raters: number;
  completionRate: number;
  rewatchRate: number;
};

export function useVideos(params: { q?: string; sort?: string; creator?: string; category?: string } = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();
  return useQuery({
    queryKey: ["videos", qs],
    queryFn: () => api<{ videos: VideoDTO[] }>(`/api/videos?${qs}`).then((r) => r.videos),
  });
}

export function useVideo(id: string) {
  return useQuery({
    queryKey: ["video", id],
    queryFn: () => api<{ video: VideoDTO }>(`/api/videos/${id}`).then((r) => r.video),
  });
}

/** Live on-chain video state (price can change after upload). */
export function useOnchainVideo(id: string | undefined) {
  return useQuery({
    queryKey: ["onchain-video", id],
    enabled: !!id,
    refetchInterval: 30_000,
    queryFn: async () => {
      const [creator, pricePerHour, active] = await readPpw<readonly [Address, bigint, boolean]>("videos", [id]);
      return { creator, pricePerHour, active };
    },
  });
}

/** Escrow balance, unsettled receipts, pending withdrawal and wallet USDC for a viewer. */
export function useEscrow(address: Address | undefined) {
  return useQuery({
    queryKey: ["escrow", address],
    enabled: !!address,
    refetchInterval: 15_000,
    queryFn: async () => {
      const [balance, wallet, pw, receipts] = await Promise.all([
        readPpw<bigint>("balanceOf", [address]),
        usdcBalance(address!),
        readPpw<readonly [bigint, bigint]>("pendingWithdrawal", [address]),
        api<{ pendingTotal: string; receipts: { creator: string; referrer: string; pending: string; cumulative_amount: string }[] }>(
          `/api/receipts?viewer=${address}`,
        ),
      ]);
      const unsettled = BigInt(receipts.pendingTotal);
      return {
        balance,
        wallet,
        unsettled,
        available: balance > unsettled ? balance - unsettled : 0n,
        pendingWithdrawal: { amount: pw[0], availableAt: Number(pw[1]) },
        receipts: receipts.receipts,
      };
    },
  });
}

export function useEvents(params: { name?: string; viewer?: string; creator?: string; videoId?: string }, enabled = true) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();
  return useQuery({
    queryKey: ["events", qs],
    enabled,
    refetchInterval: 30_000,
    queryFn: () => api<{ events: PpwEvent[] }>(`/api/events?${qs}`).then((r) => r.events),
  });
}

export type SettlementStatus = { lastRunAt: string | null; lastStatus: string | null; lastTxHash: string | null; nextRunAt: string };

export function useSettlementStatus() {
  return useQuery({
    queryKey: ["settlement-status"],
    refetchInterval: 60_000,
    queryFn: () => api<SettlementStatus>("/api/settlement/status"),
  });
}

export type Stats = {
  totalSettled: string;
  totalDeposited: string;
  creatorsPaid: number;
  viewers: number;
  minutesWatched: number;
  settlementTxs: number;
};

export function useStats() {
  return useQuery({ queryKey: ["stats"], refetchInterval: 60_000, queryFn: () => api<Stats>("/api/stats") });
}
