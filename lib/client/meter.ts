"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { eip712Domain, receiptTypes, ZERO_ADDRESS } from "../contract";
import { env } from "../env";
import { COMPLETE_RATIO, countBits, fromBase64, fullBitmap, hasBit, milestoneIndex, PASS_MS, setBit, toBase64, type ProgressDTO } from "../progress";
import { api } from "./api";
import type { StoredSessionKey } from "./session-key";
import { viewerAuthHeaders } from "./viewer-auth";

// Strict, viewer-fair metering: you pay for each second of a video once.
// - A second of the video (by playback position) is billed the first time you watch it in the
//   current 30-day window. Rewatching parts you already paid for is free, so coming back later
//   resumes billing exactly where new footage starts. 2x speed pays for content, not wall time.
// - After you've paid for (almost) all of it, or bought it for download, replays are free until
//   the pass ends: 30 days from when you first started the video.
// - Only counts while the video is really playing: not paused, ended, seeking or buffering.
//   Nothing is ever paused automatically (switching tabs or windows, long sessions): the viewer
//   decides when to pause. (Background tabs get throttled timers, so progress is measured
//   against real elapsed time rather than assuming one tick per second.)
// - Money is integer USDC base units: each new second adds pricePerHour to an accumulator and
//   the amount owed is floor(sum / 3600), rounding in the viewer's favour.
// - A receipt for the all-time cumulative amount (viewer -> creator, per referrer) is signed
//   with the session key every billed tick, POSTed every 60 paid seconds, immediately when paid
//   progress crosses 10/25/50/75/100% (the server settles onchain then), on pause, and beaconed
//   on exit.

const FLUSH_EVERY_PAID = 60;
const FREE_PING_EVERY = 30;
const JUMP_SLACK = 3; // seconds of position change beyond elapsed-time x rate still treated as playback
const RECEIPT_TTL = 3 * 24 * 3600;

type Signed = { body: string; cumulative: bigint };

const cumKey = (viewer: string, creator: string, referrer: string) =>
  `ppw:cum:${env.chainId}:${env.ppwAddress.toLowerCase()}:${viewer.toLowerCase()}:${creator.toLowerCase()}:${referrer.toLowerCase()}`;

function readLocalCum(viewer: string, creator: string, referrer: string): bigint {
  try {
    return BigInt(localStorage.getItem(cumKey(viewer, creator, referrer)) ?? "0");
  } catch {
    return 0n;
  }
}
function writeLocalCum(viewer: string, creator: string, referrer: string, v: bigint) {
  try {
    localStorage.setItem(cumKey(viewer, creator, referrer), v.toString());
  } catch {
    /* ignore */
  }
}

export type MeterState = {
  ready: boolean;
  /** Seconds of playback this session (paid + free). */
  seconds: number;
  paidSeconds: number;
  freeSeconds: number;
  sessionCost: bigint;
  /** All-time cumulative owed to this creator in this referral lane, including this session. */
  cumulative: bigint;
  /** Share of the video already paid for in this window (0–1). */
  coveredRatio: number;
  coveredSeconds: number;
  /** Free-replay pass end (ms), if any. */
  passUntil: number | null;
  /** The second at the playhead is already paid for (or under a pass): watching it is free. */
  freeNow: boolean;
  outOfFunds: boolean;
};

export function useMeter(opts: {
  videoRef: RefObject<HTMLVideoElement | null>;
  viewer?: Address;
  creator?: Address;
  referrer?: Address;
  videoId: string;
  durationSeconds: number;
  pricePerHour?: bigint;
  sessionKey: StoredSessionKey | null;
  /** Server progress (undefined while loading, null if unavailable). */
  progress: ProgressDTO | null | undefined;
  /** Spendable for this lane right now, given the cumulative amount before this session. */
  budgetFor: (cumulative: bigint) => bigint;
  enabled: boolean;
}) {
  const { videoRef, viewer, creator, videoId, pricePerHour, sessionKey, budgetFor, enabled, progress } = opts;
  const referrer = opts.referrer ?? ZERO_ADDRESS;
  const [state, setState] = useState<MeterState>({
    ready: false,
    seconds: 0,
    paidSeconds: 0,
    freeSeconds: 0,
    sessionCost: 0n,
    cumulative: 0n,
    coveredRatio: 0,
    coveredSeconds: 0,
    passUntil: null,
    freeNow: false,
    outOfFunds: false,
  });

  const base = useRef<bigint | null>(null);
  const numerator = useRef(0n);
  const coverage = useRef<Uint8Array | null>(null);
  const windowStart = useRef<number | null>(null);
  const passUntil = useRef<number | null>(null);
  const lastPos = useRef<number | null>(null);
  const milestone = useRef(-1);
  const counters = useRef({ seconds: 0, paid: 0, free: 0, paidAtFlush: 0 });
  const lastTick = useRef<number | null>(null);
  const latest = useRef<Signed | null>(null);
  const lastPosted = useRef<bigint>(-1n);
  const sessionId = useRef<string>("");
  const priceRef = useRef(pricePerHour);
  const budgetRef = useRef(budgetFor);
  const keyRef = useRef(sessionKey);
  priceRef.current = pricePerHour;
  budgetRef.current = budgetFor;
  keyRef.current = sessionKey;

  const duration = () => {
    const v = videoRef.current;
    return opts.durationSeconds > 0 ? opts.durationSeconds : v && Number.isFinite(v.duration) ? Math.floor(v.duration) : 0;
  };
  const passActive = () => passUntil.current !== null && passUntil.current > Date.now();
  const owed = () => numerator.current / 3600n;
  const cumulativeNow = () => (base.current ?? 0n) + owed();
  const coveredCount = () => (coverage.current ? countBits(coverage.current, duration()) : 0);

  // 1. Starting cumulative for this lane: max(local, stored on server, settled onchain). Never decreases.
  useEffect(() => {
    if (!enabled || !viewer || !creator) return;
    let cancelled = false;
    sessionId.current = crypto.randomUUID();
    base.current = null;
    numerator.current = 0n;
    counters.current = { seconds: 0, paid: 0, free: 0, paidAtFlush: 0 };
    api<{ cumulative: string; settled: string }>(`/api/receipts?viewer=${viewer}&creator=${creator}&referrer=${referrer}`)
      .then((r) => {
        if (cancelled) return;
        const start = [readLocalCum(viewer, creator, referrer), BigInt(r.cumulative), BigInt(r.settled)].reduce((a, b) => (b > a ? b : a), 0n);
        base.current = start;
        lastPosted.current = BigInt(r.cumulative);
        setState((s) => ({ ...s, cumulative: start }));
      })
      .catch(() => {
        if (!cancelled) base.current = readLocalCum(viewer, creator, referrer);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, viewer, creator, referrer]);

  // 2. Paid-seconds bitmap + pass from the server; later updates (e.g. after a download) merge in.
  useEffect(() => {
    if (progress === undefined) return;
    const D = progress?.durationSeconds || duration();
    const incoming = fromBase64(progress?.coverage, D);
    if (coverage.current && coverage.current.length === incoming.length) {
      for (let i = 0; i < incoming.length; i++) coverage.current[i] |= incoming[i];
    } else {
      coverage.current = incoming;
    }
    windowStart.current = progress?.windowStart ? new Date(progress.windowStart).getTime() : windowStart.current;
    if (progress?.passUntil) passUntil.current = Math.max(passUntil.current ?? 0, new Date(progress.passUntil).getTime());
    const c = coveredCount();
    milestone.current = Math.max(milestone.current, D ? milestoneIndex(c / D) : -1);
    setState((s) => ({ ...s, ready: true, coveredSeconds: c, coveredRatio: D ? c / D : 0, passUntil: passUntil.current }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress]);

  const sign = useCallback(
    async (extra = 0n): Promise<Signed | null> => {
      const key = keyRef.current;
      if (!viewer || !creator || !key || base.current === null) return null;
      const cumulative = cumulativeNow() + extra;
      const deadline = BigInt(Math.floor(Date.now() / 1000) + RECEIPT_TTL);
      const message = { viewer, creator, referrer, cumulativeAmount: cumulative, deadline };
      const signature: Hex = await privateKeyToAccount(key.privateKey).signTypedData({ domain: eip712Domain, types: receiptTypes, primaryType: "Receipt", message });
      const receipt = { viewer, creator, referrer, cumulativeAmount: cumulative.toString(), deadline: deadline.toString() };
      const body = JSON.stringify({
        receipt,
        signature,
        watch: { sessionId: sessionId.current, videoId, coverage: coverage.current ? toBase64(coverage.current) : undefined },
      });
      if (extra === 0n) {
        writeLocalCum(viewer, creator, referrer, cumulative);
        latest.current = { body, cumulative };
      }
      return { body, cumulative };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads refs
    [viewer, creator, referrer, videoId],
  );

  const flush = useCallback(async () => {
    const signed = latest.current ?? (await sign());
    if (!signed || signed.cumulative <= lastPosted.current) return;
    try {
      const res = await fetch("/api/receipts", { method: "POST", headers: { "content-type": "application/json" }, body: signed.body });
      lastPosted.current = signed.cumulative;
      const r = (await res.json().catch(() => ({}))) as { passUntil?: string | null };
      if (r.passUntil) {
        passUntil.current = new Date(r.passUntil).getTime();
        setState((s) => ({ ...s, passUntil: passUntil.current }));
      }
    } catch {
      /* retried on the next flush / beacon */
    }
  }, [sign]);

  const pingFree = useCallback(async () => {
    if (!viewer || counters.current.free === 0) return;
    const headers = await viewerAuthHeaders(viewer, keyRef.current).catch(() => ({}));
    fetch("/api/progress/play", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ viewer, videoId, sessionId: sessionId.current, freeSeconds: counters.current.free, creator, referrer }),
    }).catch(() => {});
  }, [viewer, videoId, creator, referrer]);

  const beacon = useCallback(() => {
    const signed = latest.current;
    if (!signed || signed.cumulative <= lastPosted.current) return;
    if (navigator.sendBeacon?.("/api/receipts", new Blob([signed.body], { type: "text/plain" }))) lastPosted.current = signed.cumulative;
  }, []);

  const pauseVideo = () => videoRef.current?.pause();

  // 3. The 1-second tick.
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => {
      const v = videoRef.current;
      const price = priceRef.current;
      const playing = !!v && !v.paused && !v.ended && !v.seeking && v.readyState >= 3;
      const now = Date.now();
      const elapsed = lastTick.current === null ? 1 : Math.max(1, (now - lastTick.current) / 1000);
      lastTick.current = now;
      if (!playing || base.current === null || !price || !coverage.current) {
        lastPos.current = null;
        return;
      }
      const D = duration();
      const pos = Math.min(Math.floor(v!.currentTime), Math.max(0, D - 1));
      const prev = lastPos.current;
      // Anything the playhead moved through since the last tick was watched, as long as the jump
      // fits the real time that passed (x playback speed). A bigger jump is a seek: not billed.
      const maxJump = Math.ceil(elapsed * Math.max(1, v!.playbackRate)) + JUMP_SLACK;
      const from = prev !== null && pos >= prev && pos - prev <= maxJump ? prev + 1 : pos;
      lastPos.current = pos;
      const tickSeconds = Math.max(1, Math.round(elapsed));

      const cov = coverage.current;
      const newSeconds: number[] = [];
      if (!passActive()) for (let i = from; i <= pos && i < D; i++) if (!hasBit(cov, i)) newSeconds.push(i);

      const c = counters.current;
      if (newSeconds.length > 0) {
        if (!keyRef.current) {
          pauseVideo();
          setState((s) => ({ ...s, outOfFunds: true }));
          return;
        }
        const next = numerator.current + price * BigInt(newSeconds.length);
        if (next / 3600n > budgetRef.current(base.current)) {
          pauseVideo();
          lastPos.current = null;
          setState((s) => ({ ...s, outOfFunds: true }));
          void flush();
          return;
        }
        numerator.current = next;
        newSeconds.forEach((i) => setBit(cov, i));
        c.paid += newSeconds.length;
        void sign();
        const covered = coveredCount();
        const mi = milestoneIndex(covered / D);
        if (covered / D >= COMPLETE_RATIO && passUntil.current === null) {
          passUntil.current = (windowStart.current ?? Date.now()) + PASS_MS; // server confirms on flush
        }
        if (mi > milestone.current) {
          milestone.current = mi;
          c.paidAtFlush = c.paid;
          void flush(); // server settles onchain at 10/25/50/75/100%
        } else if (c.paid - c.paidAtFlush >= FLUSH_EVERY_PAID) {
          c.paidAtFlush = c.paid;
          void flush();
        }
      } else {
        const before = c.free;
        c.free += tickSeconds;
        if (Math.floor(c.free / FREE_PING_EVERY) > Math.floor(before / FREE_PING_EVERY)) void pingFree();
      }
      c.seconds += tickSeconds;
      const covered = coveredCount();
      const nextPos = Math.min(pos + 1, D - 1);
      setState((s) => ({
        ...s,
        seconds: c.seconds,
        paidSeconds: c.paid,
        freeSeconds: c.free,
        sessionCost: owed(),
        cumulative: cumulativeNow(),
        coveredSeconds: covered,
        coveredRatio: D ? covered / D : 0,
        passUntil: passUntil.current,
        freeNow: passActive() || hasBit(cov, nextPos),
      }));
    }, 1000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, sign, flush, pingFree]);

  // 4. Pause / end -> flush and record free time.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !enabled) return;
    const onStop = () => {
      lastPos.current = null;
      void flush();
      void pingFree();
    };
    const onSeek = () => (lastPos.current = null);
    v.addEventListener("pause", onStop);
    v.addEventListener("ended", onStop);
    v.addEventListener("seeking", onSeek);
    return () => {
      v.removeEventListener("pause", onStop);
      v.removeEventListener("ended", onStop);
      v.removeEventListener("seeking", onSeek);
    };
  }, [videoRef, enabled, flush, pingFree]);

  // 5. Never auto-pause when the viewer switches tabs or windows; just make sure the latest
  //    receipt reaches the server if the page is hidden or closed.
  useEffect(() => {
    if (!enabled) return;
    const onVisibility = () => document.hidden && beacon();
    const onHide = () => beacon();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onHide);
    window.addEventListener("beforeunload", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("beforeunload", onHide);
      beacon();
    };
  }, [enabled, beacon]);

  const clearOutOfFunds = useCallback(() => setState((s) => ({ ...s, outOfFunds: false })), []);

  /**
   * Sign a receipt that also pays `amount` on top of what's owed (buying the rest of the video
   * for download). Call commit() once the server has accepted it.
   */
  const signPurchase = useCallback(
    async (amount: bigint) => {
      await flush();
      const signed = await sign(amount);
      if (!signed) return null;
      const parsed = JSON.parse(signed.body) as { receipt: unknown; signature: Hex };
      return {
        receipt: parsed.receipt,
        signature: parsed.signature,
        commit: () => {
          base.current = (base.current ?? 0n) + amount;
          lastPosted.current = signed.cumulative;
          if (viewer && creator) writeLocalCum(viewer, creator, referrer, cumulativeNow());
          coverage.current = fullBitmap(duration());
          passUntil.current = Date.now() + PASS_MS;
          setState((s) => ({ ...s, cumulative: cumulativeNow(), coveredRatio: 1, coveredSeconds: duration(), passUntil: passUntil.current, freeNow: true }));
        },
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [flush, sign, viewer, creator, referrer],
  );

  return { ...state, clearOutOfFunds, flush, signPurchase };
}
