"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon, CheckIcon, DownloadIcon, LockClosedIcon, Share1Icon } from "@radix-ui/react-icons";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { Address } from "viem";
import { AddFundsDialog } from "@/components/add-funds-dialog";
import { BillingExplainer } from "@/components/billing-explainer";
import { Player } from "@/components/player";
import { RatingStars } from "@/components/rating";
import { ShareDialog } from "@/components/share-dialog";
import { PriceTag } from "@/components/video-card";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState, Skeleton } from "@/components/ui/primitives";
import { useAppAccount } from "@/lib/client/account";
import { api } from "@/lib/client/api";
import { friendlyError } from "@/lib/client/errors";
import { useEscrow, useOnchainVideo, useSettlementStatus, useVideo } from "@/lib/client/hooks";
import { useMeter } from "@/lib/client/meter";
import { readPpw } from "@/lib/client/ppw";
import { fetchWithProgress, getOffline, saveOffline } from "@/lib/client/offline";
import { captureReferral, storedReferral } from "@/lib/client/referral";
import { currentSessionKey, type StoredSessionKey } from "@/lib/client/session-key";
import { viewerAuthHeaders } from "@/lib/client/viewer-auth";
import { ZERO_ADDRESS } from "@/lib/contract";
import { categoryLabel } from "@/lib/categories";
import { env } from "@/lib/env";
import { costForSeconds, formatDuration, formatUsdc, ONE_USDC, perMinute, shortAddress } from "@/lib/money";
import { MILESTONES, type ProgressDTO } from "@/lib/progress";
import { cn, timeAgo, timeUntil } from "@/lib/utils";

const max0 = (v: bigint) => (v > 0n ? v : 0n);
const min = (a: bigint, b: bigint) => (a < b ? a : b);

export function WatchView({ id, embedded, backHref, refParam }: { id: string; embedded?: boolean; backHref?: string; refParam?: string | null }) {
  const { data: video, isLoading, error } = useVideo(id);
  const onchain = useOnchainVideo(video?.id);
  const acct = useAppAccount();
  const viewer = acct.address;
  // A video not (yet) registered on the current contract reads back as the zero address.
  const registered = !onchain.data || onchain.data.creator !== ZERO_ADDRESS;
  const creator = (registered ? (onchain.data?.creator ?? video?.creator) : video?.creator) as Address | undefined;
  const price = registered ? (onchain.data?.pricePerHour ?? (video ? BigInt(video.price_per_hour) : undefined)) : undefined;
  const active = registered && (onchain.data?.active ?? video?.active ?? false);

  // Referral: first ?ref= link wins for this video. Ignored if it points at the viewer or the creator.
  const [storedRef, setStoredRef] = useState<Address | null>(null);
  useEffect(() => {
    captureReferral(id, refParam);
    setStoredRef(storedReferral(id));
  }, [id, refParam]);
  const referrer: Address =
    video?.referrals_enabled && storedRef && storedRef.toLowerCase() !== viewer?.toLowerCase() && storedRef.toLowerCase() !== creator?.toLowerCase()
      ? storedRef
      : ZERO_ADDRESS;
  const [shareOpen, setShareOpen] = useState(false);

  const escrow = useEscrow(viewer);
  const settlement = useSettlementStatus();
  const qc = useQueryClient();
  const videoRef = useRef<HTMLVideoElement>(null);

  // Session key: local copy + its live onchain status (expiry, cap, spent).
  const [sessionKey, setSessionKey] = useState<StoredSessionKey | null>(null);
  const reloadKey = useCallback(() => setSessionKey(viewer ? currentSessionKey(viewer) : null), [viewer]);
  useEffect(reloadKey, [reloadKey]);
  const keyStatus = useQuery({
    queryKey: ["session-key", viewer, sessionKey?.address],
    enabled: !!viewer && !!sessionKey,
    refetchInterval: 30_000,
    queryFn: async () => {
      const [expiry, spendCap, spent] = await readPpw<readonly [bigint, bigint, bigint]>("sessionKeys", [viewer, sessionKey!.address]);
      return { expiry: Number(expiry), spendCap, spent };
    },
  });
  const pairSettled = useQuery({
    queryKey: ["settled", viewer, creator, referrer],
    enabled: !!viewer && !!creator,
    refetchInterval: 15_000,
    queryFn: () => readPpw<bigint>("settled", [viewer, creator, referrer]),
  });

  const keyActive = !!keyStatus.data && keyStatus.data.expiry > Date.now() / 1000 + 60;
  const authKey = keyActive ? sessionKey : null;

  // Which seconds this viewer already paid for, and any free-replay pass (private: needs auth).
  const progressQ = useQuery({
    queryKey: ["progress", viewer, id, authKey?.address, acct.signedInAs],
    enabled: !!viewer && (keyActive || !!acct.signedInAs),
    refetchInterval: 60_000,
    queryFn: async () =>
      (await api<{ progress: ProgressDTO }>(`/api/progress?viewer=${viewer}&videoId=${id}`, { headers: await viewerAuthHeaders(viewer, authKey) })).progress,
  });
  const progress = progressQ.data;
  const passUntilMs = progress?.passUntil ? new Date(progress.passUntil).getTime() : null;

  // What can this session spend? Escrow minus everything already owed, capped by the session key.
  const otherPending = useMemo(
    () =>
      (escrow.data?.receipts ?? [])
        .filter((r) => r.creator.toLowerCase() !== creator?.toLowerCase() || r.referrer.toLowerCase() !== referrer.toLowerCase())
        .reduce((a, r) => a + BigInt(r.pending), 0n),
    [escrow.data, creator, referrer],
  );
  const budgetFor = useCallback(
    (base: bigint) => {
      if (!escrow.data || !keyStatus.data) return 0n;
      const owedHere = max0(base - (pairSettled.data ?? 0n));
      const fromBalance = escrow.data.balance - otherPending - owedHere;
      const fromKey = keyStatus.data.spendCap - keyStatus.data.spent - otherPending - owedHere;
      return max0(min(fromBalance, fromKey));
    },
    [escrow.data, keyStatus.data, otherPending, pairSettled.data],
  );

  const meter = useMeter({
    videoRef,
    viewer,
    creator,
    referrer,
    videoId: id,
    durationSeconds: video?.duration_seconds ?? 0,
    pricePerHour: price,
    sessionKey: authKey,
    progress: progressQ.isSuccess ? progress : progressQ.isError ? null : undefined,
    budgetFor,
    enabled: !!viewer && !!creator,
  });
  const passUntil = Math.max(meter.passUntil ?? 0, passUntilMs ?? 0) || null;
  const passActive = !!passUntil && passUntil > Date.now();
  const canMeter = !!viewer && !!creator && !!price && active && !!escrow.data && (keyActive || passActive);

  // Private uploads (local disk, R2) stream only through short-lived, viewer-bound links.
  const isLocal = !!video && (video.playback_url.startsWith("/media/") || video.playback_url.startsWith("r2:"));
  const streamQ = useQuery({
    queryKey: ["stream", id, viewer, keyActive, passActive],
    enabled: isLocal && !!viewer && (keyActive || passActive),
    // Links last 15 minutes (/api/stream); renew before they expire. The player keeps its position.
    staleTime: 12 * 60 * 1000,
    refetchInterval: 12 * 60 * 1000,
    refetchIntervalInBackground: true,
    queryFn: async () =>
      (await api<{ url: string }>("/api/stream", { method: "POST", json: { viewer, videoId: id }, headers: await viewerAuthHeaders(viewer, authKey) })).url,
  });
  const playerSrc = isLocal ? (streamQ.data ?? null) : (video?.playback_url ?? null);

  const sessionBudget = budgetFor(meter.ready ? meter.cumulative - meter.sessionCost : 0n);
  const remaining = max0(sessionBudget - meter.sessionCost);
  // Balance minus everything owed, including this session's live (not yet posted) amount.
  const availableNow = !escrow.data
    ? null
    : meter.ready
      ? max0(escrow.data.balance - otherPending - max0(meter.cumulative - (pairSettled.data ?? 0n)))
      : escrow.data.available;
  const needsFunds = !!viewer && !!escrow.data && !passActive && !keyActive;

  const [fundsOpen, setFundsOpen] = useState(false);
  const [fundsReason, setFundsReason] = useState<string | undefined>();

  // Gate playback: no wallet, no funds or no session key -> stop and explain.
  const onPlayAttempt = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (!viewer) {
      v.pause();
      acct.connect();
      return;
    }
    if (!active) {
      v.pause();
      return;
    }
    if (needsFunds || !canMeter) {
      v.pause();
      setFundsReason(undefined);
      setFundsOpen(true);
    }
  }, [viewer, active, needsFunds, canMeter, acct]);

  useEffect(() => {
    if (meter.outOfFunds && price) {
      const topUp = ONE_USDC * 2n;
      const minutes = Math.floor(Number((topUp * 3600n) / price) / 60);
      setFundsReason(`Not enough USDC. Add ${formatUsdc(topUp)} to keep watching for about ${minutes} more minutes.`);
      setFundsOpen(true);
    }
  }, [meter.outOfFunds, price]);

  const afterTopUp = async () => {
    reloadKey();
    meter.clearOutOfFunds();
    await Promise.all([qc.invalidateQueries({ queryKey: ["session-key"] }), qc.invalidateQueries({ queryKey: ["escrow"] })]);
  };

  // In-app download: pay whatever of the full-watch price isn't paid yet (free with a pass),
  // then the video is saved in this browser's PayPerWatch library for offline viewing.
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [downloadPct, setDownloadPct] = useState<number | null>(null);
  const [savedOffline, setSavedOffline] = useState(false);
  useEffect(() => {
    getOffline(id)
      .then((v) => setSavedOffline(!!v && new Date(v.passUntil).getTime() > Date.now()))
      .catch(() => {});
  }, [id]);
  const downloadCost = passActive ? 0n : BigInt(progress?.remainingCost ?? (price && video ? costForSeconds(price, video.duration_seconds).toString() : "0"));

  async function download() {
    if (!viewer || !video) return;
    try {
      const headers = await viewerAuthHeaders(viewer, authKey);
      let body: Record<string, unknown> = { viewer, videoId: id };
      let commit: (() => void) | undefined;
      if (downloadCost > 0n) {
        if (!keyActive || (availableNow ?? 0n) < downloadCost) {
          setDownloadOpen(false);
          setFundsReason(`Downloading costs ${formatUsdc(downloadCost)}. Add funds to continue.`);
          setFundsOpen(true);
          return;
        }
        const purchase = await meter.signPurchase(downloadCost);
        if (!purchase) throw new Error("Couldn't sign the payment. Refresh and try again.");
        body = { ...body, receipt: purchase.receipt, signature: purchase.signature };
        commit = purchase.commit;
      }
      setDownloadPct(0);
      const r = await api<{ url: string; passUntil: string }>("/api/downloads", { method: "POST", json: body, headers });
      commit?.();
      const blob = await fetchWithProgress(r.url, setDownloadPct);
      await saveOffline({
        videoId: id.toLowerCase(),
        viewer: viewer.toLowerCase(),
        title: video.title,
        category: video.category,
        thumbnail: video.thumbnail_url,
        durationSeconds: video.duration_seconds,
        passUntil: r.passUntil,
        savedAt: new Date().toISOString(),
        bytes: blob.size,
        blob,
      });
      setSavedOffline(true);
      setDownloadOpen(false);
      toast.success("Saved to Downloads. Watch it offline in PayPerWatch.", { action: { label: "Open", onClick: () => (window.location.href = "/library") } });
      await Promise.all([qc.invalidateQueries({ queryKey: ["progress"] }), qc.invalidateQueries({ queryKey: ["escrow"] })]);
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setDownloadPct(null);
    }
  }

  if (error) {
    return (
      <div className="py-16">
        <EmptyState title="Video not found" body="It may have been removed by its creator." />
      </div>
    );
  }
  if (isLoading || !video) {
    return (
      <div className={cn("grid gap-8", !embedded && "lg:grid-cols-[1fr_340px]")}>
        <Skeleton className="aspect-video w-full rounded-lg" />
        {!embedded && <Skeleton className="h-80 w-full rounded-lg" />}
      </div>
    );
  }

  const fullCost = price ? costForSeconds(price, video.duration_seconds) : 0n;
  const walletHref = embedded ? `${env.appUrl}/wallet` : "/wallet";

  const overlay = !registered ? (
    <Overlay>
      <LockClosedIcon className="size-5" aria-hidden />
      <p className="max-w-xs">PayPerWatch moved to a new contract and this video hasn&apos;t been republished yet. Check back soon.</p>
    </Overlay>
  ) : !active ? (
    <Overlay>
      <LockClosedIcon className="size-5" aria-hidden />
      <p>This video has been unpublished by its creator.</p>
    </Overlay>
  ) : !viewer ? (
    <Overlay>
      <p className="text-[17px] font-medium">Connect a wallet to watch</p>
      <p className="max-w-xs text-white/75">You&apos;ll only pay for the seconds you play{price ? `, ${formatUsdc(perMinute(price), { decimals: 4 })} a minute` : ""}.</p>
      <Button variant="onImage" onClick={acct.connect}>
        Connect wallet
      </Button>
    </Overlay>
  ) : needsFunds && !fundsOpen ? (
    <Overlay>
      <p className="text-[17px] font-medium">Add funds to start watching</p>
      <p className="max-w-xs text-white/75">A full watch costs about {formatUsdc(fullCost)}. Anything you don&apos;t use stays yours.</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="onImage" onClick={() => setFundsOpen(true)}>
          Add funds
        </Button>
        {!acct.signedInAs && (
          <Button variant="outline" className="border-white/40 text-white hover:bg-white/10" onClick={() => acct.signIn().catch((e) => toast.error(friendlyError(e)))}>
            Watched it before? Sign in
          </Button>
        )}
      </div>
    </Overlay>
  ) : null;

  return (
    <div className={cn("grid gap-8", !embedded && "lg:grid-cols-[1fr_340px]")}>
      <div className="min-w-0">
        {backHref && (
          <Link href={backHref} className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors duration-200 hover:text-foreground">
            <ArrowLeftIcon /> All videos
          </Link>
        )}
        <Player ref={videoRef} src={playerSrc} poster={video.thumbnail_url} title={video.title} onPlayAttempt={onPlayAttempt} overlay={overlay} />
        <div className="mt-6">
          <p className="text-[13px] text-muted-foreground">{categoryLabel(video.category)}</p>
          <h1 className="mt-1 font-display text-[26px] font-semibold md:text-[30px]">{video.title}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span className="font-mono text-[13px]">{shortAddress(creator)}</span>
            {price && <PriceTag pricePerHour={price} />}
            <span className="tabular">{formatDuration(video.duration_seconds)}</span>
            {price && <span>Full watch ≈ {formatUsdc(fullCost)}</span>}
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3 border-y py-4">
            {video.rating !== null ? (
              <div className="flex items-center gap-2.5" title="Rated by how much of the video people watch and how often they come back">
                <RatingStars rating={video.rating} />
                <span className="text-[15px] font-medium tabular">{video.rating.toFixed(1)}</span>
                <span className="text-[13px] text-muted-foreground">
                  {video.raters} {video.raters === 1 ? "viewer" : "viewers"} · {Math.round(video.completionRate * 100)}% finish it
                  {video.rewatchRate > 0 ? ` · ${Math.round(video.rewatchRate * 100)}% come back` : ""}
                </span>
              </div>
            ) : (
              <span className="text-[13px] text-muted-foreground">Not rated yet. Ratings come from how people watch.</span>
            )}
            <div className="ml-auto flex gap-2">
              {!video.playback_url.endsWith(".m3u8") &&
                (embedded ? (
                  <Button variant="outline" size="sm" asChild>
                    <a href={`${env.appUrl}/watch/${video.id}`} target="_blank" rel="noopener">
                      <DownloadIcon /> Download in app
                    </a>
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => (viewer ? setDownloadOpen(true) : acct.connect())}>
                    {savedOffline ? <CheckIcon /> : <DownloadIcon />} {savedOffline ? "Downloaded" : "Download"}
                  </Button>
                ))}
              <Button variant="outline" size="sm" onClick={() => setShareOpen(true)}>
                <Share1Icon /> Share{video.referrals_enabled && viewer && viewer.toLowerCase() !== creator?.toLowerCase() ? " and earn" : ""}
              </Button>
            </div>
          </div>
          {passActive ? (
            <p className="mt-4 rounded-md bg-tint px-4 py-3 text-[13px] text-muted-foreground">
              <span className="font-medium text-foreground">You&apos;ve paid for this video.</span> Replays{progress?.downloadedAt ? " and re-downloads" : ""} are free until{" "}
              {new Date(passUntil!).toLocaleDateString(undefined, { month: "long", day: "numeric" })}.
            </p>
          ) : meter.coveredSeconds > 0 ? (
            <p className="mt-4 rounded-md bg-tint px-4 py-3 text-[13px] text-muted-foreground">
              <span className="font-medium text-foreground">You&apos;ve already paid for {formatDuration(meter.coveredSeconds)} of this video.</span> Those parts replay
              free. Billing only runs on parts you haven&apos;t watched yet. Finish it and replays are free for 30 days.
            </p>
          ) : null}
          {referrer !== ZERO_ADDRESS && (
            <p className="mt-4 rounded-md bg-tint px-4 py-3 text-[13px] text-muted-foreground">
              Shared with you by <span className="font-mono text-foreground">{shortAddress(referrer)}</span>. They earn 5% of what you spend on this video,
              paid from the creator&apos;s share. Your price is the same.
            </p>
          )}
          {video.description && <p className="mt-5 max-w-2xl whitespace-pre-line text-[15px] text-muted-foreground">{video.description}</p>}
        </div>
        {embedded && meterPanel("mt-6")}
      </div>

      {!embedded && (
        <aside className="space-y-4" aria-label="Your balance and billing">
          {meterPanel()}
          <BillingExplainer />
        </aside>
      )}

      <AddFundsDialog
        open={fundsOpen}
        onOpenChange={(o) => {
          setFundsOpen(o);
          if (!o) setFundsReason(undefined);
        }}
        title={meter.outOfFunds ? "Your balance ran out" : "Add funds to start watching"}
        reason={fundsReason}
        onDone={afterTopUp}
      />

      <ShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        videoId={video.id}
        referralsEnabled={video.referrals_enabled}
        isCreator={!!viewer && viewer.toLowerCase() === creator?.toLowerCase()}
      />

      <Dialog
        open={downloadOpen}
        onOpenChange={(o) => downloadPct === null && setDownloadOpen(o)}
        title="Download to watch offline"
        description={
          downloadCost === 0n
            ? `Included with your pass. It stays in your PayPerWatch Downloads until ${passUntil ? new Date(passUntil).toLocaleDateString(undefined, { month: "long", day: "numeric" }) : "your pass ends"}. Delete it and download again any time before then for free.`
            : `${formatUsdc(downloadCost)}: the rest of the full-watch price (you're never charged twice for parts you've already paid for). Then it's yours to watch offline in PayPerWatch for 30 days, and re-downloads are free.`
        }
      >
        {downloadPct !== null ? (
          <div className="space-y-2">
            <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={downloadPct} aria-valuemin={0} aria-valuemax={100} aria-label="Download progress">
              <div className="h-full origin-left bg-secondary transition-transform duration-300 ease-apple" style={{ transform: `scaleX(${downloadPct / 100})` }} />
            </div>
            <p className="text-[13px] text-muted-foreground">Saving to your Downloads… {downloadPct}%</p>
          </div>
        ) : (
          <Button className="w-full" size="lg" onClick={download}>
            {downloadCost === 0n ? "Download free" : `Pay ${formatUsdc(downloadCost)} and download`}
          </Button>
        )}
        <p className="mt-3 text-center text-[12px] text-muted-foreground">Downloads play only inside PayPerWatch, like offline videos in other streaming apps.</p>
      </Dialog>

    </div>
  );

  // A render function (not a component) so the live meter updates in place instead of remounting.
  function meterPanel(className?: string) {
    return (
      <section className={cn("rounded-lg border bg-surface p-6", className)} aria-label="Balance and live meter">
        <p className="text-[13px] text-muted-foreground">Available</p>
        {viewer ? (
          <p className="mt-1 h-10 font-display text-[32px] font-semibold tabular">{availableNow !== null ? formatUsdc(availableNow, { suffix: false }) : <Skeleton className="h-9 w-28" />}</p>
        ) : (
          <p className="mt-1 text-[15px]">Connect a wallet to see your balance.</p>
        )}

        <div className="mt-5 border-t pt-5" aria-live="polite">
          <p className="text-[13px] text-muted-foreground">This session</p>
          <p className="mt-1 font-mono text-[22px] tabular">
            {formatDuration(meter.seconds)} <span className="text-muted-foreground">·</span>{" "}
            <span className="text-secondary">{formatUsdc(meter.sessionCost, { suffix: false })}</span>
          </p>
          <p className="mt-1 h-5 text-[13px] text-muted-foreground">
            {passActive
              ? "Free replay: you've paid for this video"
              : meter.freeNow && meter.seconds > 0
                ? "Free right now: you've already paid for this part"
                : price && viewer && keyActive
                  ? `${formatUsdc(remaining)} left in this session`
                  : "\u00a0"}
          </p>
        </div>

        <div className="mt-5">
          <div className="flex items-baseline justify-between text-[13px]">
            <span className="text-muted-foreground">Paid for</span>
            <span className="tabular">{Math.round((passActive ? 1 : meter.coveredRatio) * 100)}%</span>
          </div>
          <div className="relative mt-2 h-1.5 rounded-full bg-muted" aria-hidden>
            <div className="h-full origin-left rounded-full bg-secondary transition-transform duration-500 ease-apple" style={{ transform: `scaleX(${passActive ? 1 : meter.coveredRatio})` }} />
            {MILESTONES.slice(0, -1).map((m) => (
              <span key={m} className="absolute top-1/2 h-2.5 w-px -translate-y-1/2 bg-border" style={{ left: `${m * 100}%` }} />
            ))}
          </div>
          <p className="mt-2 text-[12px] text-muted-foreground">Payment settles onchain at 10%, 25%, 50%, 75% and 100%.</p>
        </div>

        <p className="mt-5 text-[13px] text-muted-foreground">
          {settlement.data ? `Last settled ${timeAgo(settlement.data.lastRunAt)} · next in about ${timeUntil(settlement.data.nextRunAt)}` : " "}
        </p>
        {viewer && (
          <div className="mt-5 flex gap-2">
            <Button size="sm" onClick={() => setFundsOpen(true)}>
              Add funds
            </Button>
            <Button size="sm" variant="ghost" asChild>
              <a href={walletHref} target={embedded ? "_blank" : undefined} rel="noopener">
                Wallet
              </a>
            </Button>
          </div>
        )}
      </section>
    );
  }
}

function Overlay({ children, soft }: { children: React.ReactNode; soft?: boolean }) {
  return (
    <div
      className={cn(
        "absolute inset-0 flex animate-[fadeIn_240ms_ease] flex-col items-center justify-center gap-3 p-6 text-center text-sm text-white",
        soft ? "pointer-events-none bg-black/35" : "bg-black/70 backdrop-blur-[2px]",
      )}
    >
      {children}
    </div>
  );
}
