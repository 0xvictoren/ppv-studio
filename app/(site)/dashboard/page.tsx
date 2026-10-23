"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, CodeIcon, InfoCircledIcon, TrashIcon } from "@radix-ui/react-icons";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Address } from "viem";
import { EventsTable } from "@/components/events-table";
import { SettleNowButton } from "@/components/settle-now";
import { SignInGate } from "@/components/sign-in-gate";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle, EmptyState, Input, PageTitle, Skeleton } from "@/components/ui/primitives";
import { Switch } from "@/components/ui/switch";
import { useAppAccount } from "@/lib/client/account";
import { api } from "@/lib/client/api";
import { friendlyError } from "@/lib/client/errors";
import { useEvents, useVideos, type VideoDTO } from "@/lib/client/hooks";
import { readPpw } from "@/lib/client/ppw";
import { useTx } from "@/lib/client/tx";
import type { PpwEvent } from "@/lib/contract";
import { ZERO_ADDRESS } from "@/lib/contract";
import { env } from "@/lib/env";
import { feeOf, PLATFORM_FEE_LABEL, formatMinutes, formatUsdc, MAX_PRICE_PER_HOUR, parseUsdc, toDecimal } from "@/lib/money";

type Session = { video_id: string; seconds: number; amount: string };

/** What a Settled event paid the creator: delta minus platform fee minus any referral reward. */
const creatorNet = (e: PpwEvent) => BigInt(String(e.args.delta)) - BigInt(String(e.args.fee)) - BigInt(String(e.args.referralAmount ?? "0"));

export default function DashboardPage() {
  return (
    <div className="container space-y-8">
      <PageTitle title="Dashboard" subtitle="Your videos, watch time and earnings." />
      <SignInGate purpose="Sign in to manage your videos and prices.">
        <Dashboard />
      </SignInGate>
    </div>
  );
}

function Dashboard() {
  const { address } = useAppAccount() as { address: Address };
  const videos = useVideos({ creator: address });
  const settled = useEvents({ creator: address, name: "Settled" });
  const pending = useQuery({
    queryKey: ["creator-pending", address],
    refetchInterval: 30_000,
    queryFn: () => api<{ pendingTotal: string }>(`/api/receipts?creator=${address}`).then((r) => BigInt(r.pendingTotal)),
  });
  const sessions = useQuery({
    queryKey: ["watch-sessions", "creator", address],
    queryFn: () => api<{ sessions: Session[] }>(`/api/watch-sessions?creator=${address}`).then((r) => r.sessions),
  });

  const earned = useMemo(
    () => (settled.data ?? []).reduce((a, e) => a + creatorNet(e), 0n),
    [settled.data],
  );
  const daily = useMemo(() => {
    const m = new Map<string, bigint>();
    for (const e of settled.data ?? []) {
      const day = new Date(e.timestamp * 1000).toISOString().slice(0, 10);
      m.set(day, (m.get(day) ?? 0n) + creatorNet(e));
    }
    return [...m.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-30)
      .map(([day, v]) => ({ day: day.slice(5), usdc: Number(v) / 1e6 })); // display only
  }, [settled.data]);
  const perVideo = useMemo(() => {
    const m = new Map<string, { seconds: number; amount: bigint }>();
    for (const s of sessions.data ?? []) {
      const r = m.get(s.video_id) ?? { seconds: 0, amount: 0n };
      r.seconds += s.seconds;
      r.amount += BigInt(s.amount);
      m.set(s.video_id, r);
    }
    return m;
  }, [sessions.data]);
  const pendingNet = pending.data !== undefined ? pending.data - feeOf(pending.data) : undefined;

  return (
    <>
      <div className="flex items-start gap-3 rounded-lg border border-primary-border bg-tint p-5 text-[15px]">
        <InfoCircledIcon className="mt-0.5 size-4 shrink-0 text-secondary" aria-hidden />
        <p>
          <strong>No claim button needed.</strong> Earnings go straight to your wallet at every hourly settlement, minus
          a {PLATFORM_FEE_LABEL} platform fee.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Earned (paid to your wallet)" value={settled.data ? formatUsdc(earned) : null} />
        <Stat label="Pending (unsettled)" value={pendingNet !== undefined ? formatUsdc(pendingNet) : null} hint="Paid at the next hourly settlement" />
        <Stat label="Total watch time" value={sessions.data ? formatMinutes(sessions.data.reduce((a, s) => a + s.seconds, 0)) : null} />
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Daily earnings</CardTitle>
          <SettleNowButton />
        </CardHeader>
        <CardContent>
          {settled.isLoading ? (
            <Skeleton className="h-56 w-full" />
          ) : daily.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No earnings yet. They appear here after the first hourly settlement.</p>
          ) : (
            <div className="h-56" role="img" aria-label={`Daily earnings for the last ${daily.length} days`}>
              <ResponsiveContainer>
                <BarChart data={daily}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickFormatter={(v) => `$${v}`} width={48} />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                    formatter={(v) => [`$${Number(v).toFixed(4)} USDC`, "Earned"]}
                  />
                  <Bar dataKey="usdc" fill="hsl(var(--secondary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>My videos</CardTitle>
          <Button asChild size="sm">
            <Link href="/upload">Upload</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {videos.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : !videos.data?.length ? (
            <EmptyState title="No videos yet" body="Upload your first video and set a price per hour.">
              <Button asChild>
                <Link href="/upload">Upload a video</Link>
              </Button>
            </EmptyState>
          ) : (
            <>
            <MoveAllBanner videos={videos.data} />
            <ul className="divide-y">
              {videos.data.map((v) => (
                <VideoRow key={v.id} video={v} stats={perVideo.get(v.id)} />
              ))}
            </ul>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Settlements</CardTitle>
        </CardHeader>
        <CardContent>
          {settled.data?.length ? (
            <EventsTable events={settled.data} perspective="creator" />
          ) : (
            <p className="text-sm text-muted-foreground">No settlements yet.</p>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: string | null; hint?: string }) {
  return (
    <Card className="p-6">
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <p className="mt-1 h-9 font-display text-[26px] font-semibold tabular">{value ?? <Skeleton className="h-8 w-28" />}</p>
      <p className="mt-1 min-h-4 text-[13px] text-muted-foreground">{hint ?? " "}</p>
    </Card>
  );
}

function VideoRow({ video, stats }: { video: VideoDTO; stats?: { seconds: number; amount: bigint } }) {
  const { address } = useAppAccount();
  const qc = useQueryClient();
  const priceTx = useTx();
  const activeTx = useTx();
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(video.referrals_enabled);
  const toggleSharing = async (on: boolean) => {
    setSharing(on);
    try {
      await api(`/api/videos/${video.id}`, { method: "PATCH", json: { referralsEnabled: on } });
      await qc.invalidateQueries({ queryKey: ["videos"] });
    } catch {
      setSharing(!on);
    }
  };
  const copyEmbed = async () => {
    await navigator.clipboard.writeText(`<div data-ppw="video" data-video="${video.id}"></div>
<script src="${env.appUrl}/embed.js" async></script>`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  const live = useQuery({
    queryKey: ["onchain-video", video.id],
    queryFn: async () => {
      const [creator, price, active] = await readPpw<readonly [string, bigint, boolean]>("videos", [video.id]);
      return { price, active, registered: creator !== "0x0000000000000000000000000000000000000000" };
    },
  });
  const notOnChain = live.data?.registered === false;
  const republishTx = useTx();
  const price = live.data && live.data.price > 0n ? live.data.price : BigInt(video.price_per_hour);
  const active = live.data?.active ?? video.active;
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [draft, setDraft] = useState(toDecimal(price, 2));
  const next = parseUsdc(draft, 2);
  const invalid = next === null || next <= 0n || next > MAX_PRICE_PER_HOUR;

  const sync = async () => {
    await api(`/api/videos/${video.id}`, { method: "PATCH" }).catch(() => {});
    await Promise.all([live.refetch(), qc.invalidateQueries({ queryKey: ["videos"] })]);
  };

  return (
    <li className="flex flex-col gap-3 py-4 md:flex-row md:flex-wrap md:items-center">
      <Link href={`/watch/${video.id}`} className="flex min-w-0 flex-1 items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {video.thumbnail_url && <img src={video.thumbnail_url} alt="" className="aspect-video w-28 shrink-0 rounded object-cover" />}
        <div className="min-w-0">
          <p className="truncate font-medium">{video.title}</p>
          <p className="text-xs text-muted-foreground">
            {video.views} views · {formatMinutes(stats?.seconds ?? 0)} watched · {formatUsdc(stats?.amount ?? 0n)} watched value
            {!active && <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-muted-foreground">Unpublished</span>}
          </p>
        </div>
      </Link>
      {notOnChain && (
        <div className="flex flex-wrap items-center gap-3 rounded-md bg-tint px-4 py-3 text-[13px] text-muted-foreground md:basis-full md:order-last">
          <span>PayPerWatch moved to a new contract. Move this video there so people can keep watching. No re-upload: the file, price, stats and transcript stay the same.</span>
          <Button
            size="sm"
            disabled={republishTx.busy}
            onClick={async () => {
              const ok = await republishTx.run(address, [{ label: "Move", fn: "registerVideo", args: [video.id, BigInt(video.price_per_hour)] }], "Moved to the new contract.");
              if (ok) await sync();
            }}
          >
            {republishTx.label("Move to new contract")}
          </Button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {editing ? (
          <>
            <label className="sr-only" htmlFor={`price-${video.id}`}>New price per hour (USDC)</label>
            <Input id={`price-${video.id}`} className="w-24" inputMode="decimal" value={draft} onChange={(e) => setDraft(e.target.value)} aria-invalid={invalid} />
            <span className="text-sm text-muted-foreground">/hr</span>
            <Button
              size="sm"
              disabled={invalid || priceTx.busy}
              onClick={async () => {
                const ok = await priceTx.run(address, [{ label: "Update price", fn: "updatePrice", args: [video.id, next] }], `Price updated to ${formatUsdc(next!)}/hr.`);
                if (ok) {
                  setEditing(false);
                  await sync();
                }
              }}
            >
              {priceTx.label("Save")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={priceTx.busy}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <span className="text-sm font-medium tabular">{formatUsdc(price)}/hr</span>
            <Button size="sm" variant="outline" onClick={() => { setDraft(toDecimal(price, 2)); setEditing(true); }}>
              Edit price
            </Button>
          </>
        )}
        <Button
          size="sm"
          variant={active ? "ghost" : "secondary"}
          disabled={activeTx.busy}
          onClick={async () => {
            const ok = await activeTx.run(address, [{ label: active ? "Unpublish" : "Republish", fn: "setVideoActive", args: [video.id, !active] }], active ? "Video unpublished." : "Video is live again.");
            if (ok) await sync();
          }}
        >
          {activeTx.label(active ? "Unpublish" : "Republish")}
        </Button>
        <label className="flex items-center gap-2 text-[13px] text-muted-foreground" title="Let viewers earn 5% for sharing this video">
          Share and earn
          <Switch checked={sharing} onChange={toggleSharing} label={`Share and earn for ${video.title}`} />
        </label>
        <Button size="sm" variant="ghost" onClick={copyEmbed} aria-label={`Copy embed code for ${video.title}`}>
          {copied ? <CheckIcon /> : <CodeIcon />} {copied ? "Copied" : "Embed"}
        </Button>
        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setDeleting(true)} aria-label={`Delete ${video.title}`}>
          <TrashIcon /> Delete
        </Button>
      </div>
      <DeleteDialog open={deleting} onOpenChange={setDeleting} video={video} activeOnchain={!notOnChain && active} />
    </li>
  );
}

/** After a contract change: one button that moves every video still on the old contract. */
function MoveAllBanner({ videos }: { videos: VideoDTO[] }) {
  const { address } = useAppAccount();
  const qc = useQueryClient();
  const tx = useTx();
  const missing = useQuery({
    queryKey: ["onchain-missing", videos.map((v) => v.id).join()],
    queryFn: async () => {
      const rows = await Promise.all(videos.map(async (v) => ({ v, creator: (await readPpw<readonly [string, bigint, boolean]>("videos", [v.id]))[0] })));
      return rows.filter((r) => r.creator === ZERO_ADDRESS).map((r) => r.v);
    },
  });
  const list = missing.data ?? [];
  if (list.length < 2) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-primary-border bg-tint px-4 py-3 text-[13px]">
      <span>
        {list.length} videos are still on the old contract. Move them all with one confirmation per video. Nothing is uploaded again.
      </span>
      <Button
        size="sm"
        disabled={tx.busy}
        onClick={async () => {
          const ok = await tx.run(
            address,
            list.map((v) => ({ label: `Move "${v.title}"`, fn: "registerVideo" as const, args: [v.id, BigInt(v.price_per_hour)] })),
            `Moved ${list.length} videos to the new contract.`,
          );
          await Promise.all(list.map((v) => api(`/api/videos/${v.id}`, { method: "PATCH" }).catch(() => {})));
          await qc.invalidateQueries();
          if (ok) await missing.refetch();
        }}
      >
        {tx.label(`Move all ${list.length}`)}
      </Button>
    </div>
  );
}

/** Delete for good: unpublish onchain first if needed (one confirmation), then remove everything. */
function DeleteDialog({ open, onOpenChange, video, activeOnchain }: { open: boolean; onOpenChange: (o: boolean) => void; video: VideoDTO; activeOnchain: boolean }) {
  const { address } = useAppAccount();
  const qc = useQueryClient();
  const tx = useTx();
  const [busy, setBusy] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const working = busy || tx.busy;

  async function remove() {
    setBusy(true);
    try {
      if (activeOnchain) {
        const ok = await tx.run(address, [{ label: "Unpublish", fn: "setVideoActive", args: [video.id, false] }], "Unpublished. Deleting…");
        if (!ok) return;
      }
      await api(`/api/videos/${video.id}`, { method: "DELETE" });
      toast.success(`Deleted "${video.title}".`);
      onOpenChange(false);
      await qc.invalidateQueries({ queryKey: ["videos"] });
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !working && onOpenChange(o)}
      title="Delete this video?"
      description="This removes it from PayPerWatch for good: the listing, the uploaded file, its stream and its transcript. It can't be undone."
    >
      <ul className="list-disc space-y-1.5 pl-5 text-[13px] text-muted-foreground">
        <li>Money you&apos;ve already earned stays yours, and payments for watching up to now still settle.</li>
        <li>People who downloaded it can keep watching their copy until their 30-day pass ends.</li>
        {activeOnchain && <li>Your wallet will ask you to confirm one transaction to unpublish it first.</li>}
      </ul>
      <label className="mt-5 block text-[13px]" htmlFor={`confirm-${video.id}`}>
        Type <strong>delete</strong> to confirm
      </label>
      <Input id={`confirm-${video.id}`} className="mt-1.5" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} disabled={working} autoComplete="off" />
      <Button variant="destructive" className="mt-4 w-full" disabled={confirmText.trim().toLowerCase() !== "delete" || working} onClick={remove}>
        {tx.busy ? tx.label("") : busy ? "Deleting…" : `Delete "${video.title}"`}
      </Button>
    </Dialog>
  );
}
