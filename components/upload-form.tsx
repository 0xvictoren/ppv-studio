"use client";

import { CheckCircledIcon, ExternalLinkIcon, ReloadIcon, UploadIcon, VideoIcon } from "@radix-ui/react-icons";
import Link from "next/link";
import { useRef, useState, type DragEvent } from "react";
import type { Address, Hex } from "viem";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/primitives";
import { Switch } from "@/components/ui/switch";
import { useAppAccount } from "@/lib/client/account";
import { api } from "@/lib/client/api";
import { friendlyError } from "@/lib/client/errors";
import { sendTx, waitTx } from "@/lib/client/ppw";
import { CATEGORIES, type CategoryId } from "@/lib/categories";
import { computeVideoId, REFERRAL_LABEL } from "@/lib/contract";
import { explorerTx } from "@/lib/env";
import { NOTE_MAX, NOTE_MIN } from "@/lib/review";
import type { ReviewRow } from "@/lib/server/content-db";
import { costForSeconds, feeOf, PLATFORM_FEE_LABEL, formatDuration, formatUsdc, MAX_PRICE_PER_HOUR, ONE_USDC, parseUsdc, perMinute } from "@/lib/money";
import { imageToThumbnail, inspectVideo, uploadVideo, type UploadResult } from "@/lib/storage/client";
import { cn } from "@/lib/utils";

const PRESETS = [250_000n, 500_000n, ONE_USDC, 2n * ONE_USDC];

type Phase =
  | { k: "edit" }
  | { k: "uploading"; pct: number }
  | { k: "checking"; review: ReviewRow | null }
  | { k: "held"; review: ReviewRow }
  | { k: "blocked"; review: ReviewRow }
  | { k: "wallet" }
  | { k: "pending"; hash: Hex }
  | { k: "saving"; hash: Hex }
  | { k: "done"; hash: Hex; videoId: Hex }
  | { k: "failed"; message: string };

export function UploadForm({ watchHref, dashboardHref }: { watchHref: (id: string) => string; dashboardHref?: string }) {
  const { address } = useAppAccount();
  const [file, setFile] = useState<File | null>(null);
  const [meta, setMeta] = useState<{ duration: number; thumbnails: string[] } | null>(null);
  const [thumb, setThumb] = useState(0);
  const [customThumb, setCustomThumb] = useState<string | null>(null);
  const [thumbError, setThumbError] = useState<string | null>(null);
  const [shareEnabled, setShareEnabled] = useState(false);
  const thumbInputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<CategoryId>("movies");
  const [preset, setPreset] = useState<bigint | null>(500_000n);
  const [custom, setCustom] = useState("");
  const [phase, setPhase] = useState<Phase>({ k: "edit" });
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const uploaded = useRef<UploadResult | null>(null);
  const reviewed = useRef<ReviewRow | null>(null);
  const registered = useRef<Hex | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const price = preset ?? (custom ? parseUsdc(custom, 2) : null);
  const priceError =
    preset === null && custom
      ? price === null
        ? "Enter a price like 0.75 (up to 2 decimals)."
        : price <= 0n
          ? "Price must be more than $0."
          : price > MAX_PRICE_PER_HOUR
            ? "Price can't be more than $100 an hour."
            : null
      : preset === null
        ? "Choose or enter a price."
        : null;
  const duration = Math.round(meta?.duration ?? 0);
  const fullCost = price ? costForSeconds(price, duration) : 0n;
  const hundredViewers = fullCost * 100n;
  const toCreator = hundredViewers - feeOf(hundredViewers);
  const busy = ["uploading", "checking", "wallet", "pending", "saving"].includes(phase.k);
  const thumbnails = [...(customThumb ? [customThumb] : []), ...(meta?.thumbnails ?? [])];
  const chosenThumb = thumbnails[thumb] ?? null;

  async function pickThumb(f: File | undefined) {
    setThumbError(null);
    if (!f) return;
    try {
      setCustomThumb(await imageToThumbnail(f));
      setThumb(0);
    } catch (e) {
      setThumbError(friendlyError(e));
    }
  }
  const valid = !!file && !!meta && title.trim().length > 0 && !!price && !priceError;

  async function pickFile(f: File | undefined) {
    setFileError(null);
    if (!f) return;
    if (!f.type.startsWith("video/")) {
      setFileError("That isn't a video file. Try MP4, MOV or WebM.");
      return;
    }
    setFile(f);
    uploaded.current = null;
    reviewed.current = null;
    registered.current = null;
    setPhase({ k: "edit" });
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "));
    try {
      setMeta(await inspectVideo(f));
      setThumb(0);
    } catch (e) {
      setFile(null);
      setFileError(friendlyError(e));
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void pickFile(e.dataTransfer.files[0]);
  };

  async function publish() {
    if (!valid || !address || !file || !price) return;
    try {
      if (!uploaded.current) {
        setPhase({ k: "uploading", pct: 0 });
        uploaded.current = await uploadVideo(file, (pct) => setPhase({ k: "uploading", pct }));
      }
      const { contentCid, playbackUrl, uploadRef } = uploaded.current;
      const videoId = computeVideoId(address as Address, contentCid);

      if (!reviewed.current) {
        setPhase({ k: "checking", review: null });
        const review = await checkOriginality({ contentCid, playbackUrl, uploadRef, title, description, durationSeconds: duration }, (r) =>
          setPhase({ k: "checking", review: r }),
        );
        if (review.status === "blocked" || review.status === "held") {
          setPhase({ k: review.status, review });
          return;
        }
        reviewed.current = review;
      }

      if (!registered.current) {
        setPhase({ k: "wallet" });
        const hash = await sendTx("registerVideo", [videoId, price], address);
        setPhase({ k: "pending", hash });
        await waitTx(hash);
        registered.current = hash;
      }
      const hash = registered.current;

      setPhase({ k: "saving", hash });
      await api("/api/videos", {
        method: "POST",
        json: { txHash: hash, contentCid, uploadRef, title, description, category, referralsEnabled: shareEnabled, thumbnailUrl: chosenThumb, playbackUrl, durationSeconds: duration },
      });
      setPhase({ k: "done", hash, videoId });
    } catch (e) {
      setPhase({ k: "failed", message: friendlyError(e) });
    }
  }

  async function explain(note: string) {
    if (phase.k !== "held") return;
    try {
      const { review } = await api<{ review: ReviewRow }>(`/api/reviews/${encodeURIComponent(phase.review.id)}`, { method: "POST", json: { note } });
      reviewed.current = review;
      await publish();
    } catch (e) {
      setPhase({ k: "failed", message: friendlyError(e) });
    }
  }

  if (phase.k === "done") {
    const link = explorerTx(phase.hash);
    return (
      <div className="animate-[fadeIn_300ms_ease] rounded-xl border bg-surface px-8 py-14 text-center">
        <CheckCircledIcon className="mx-auto size-8 text-secondary" aria-hidden />
        <h2 className="mt-4 font-display text-[26px] font-semibold">Your video is live</h2>
        <p className="mx-auto mt-2 max-w-md text-[15px] text-muted-foreground">
          Registered on Arc at {formatUsdc(price!)} an hour. Earnings arrive in your wallet at every hourly settlement.
          {reviewed.current?.score != null && ` Originality score: ${reviewed.current.score}/100.`}
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button asChild>
            <Link href={watchHref(phase.videoId.toLowerCase())}>View video</Link>
          </Button>
          {dashboardHref && (
            <Button asChild variant="outline">
              <Link href={dashboardHref}>Dashboard</Link>
            </Button>
          )}
          {link && (
            <Button asChild variant="ghost">
              <a href={link} target="_blank" rel="noopener noreferrer">
                Transaction <ExternalLinkIcon />
              </a>
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-12">
      <Section n="1" title="Video">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-12 text-center transition-[background-color,border-color] duration-200",
            dragging ? "border-secondary bg-tint" : "bg-surface",
          )}
        >
          {file ? (
            <>
              <VideoIcon className="size-6 text-secondary" aria-hidden />
              <p className="font-medium">{file.name}</p>
              <p className="text-[13px] text-muted-foreground tabular">
                {(file.size / 1e6).toFixed(1)} MB · {meta ? formatDuration(meta.duration) : "Reading…"}
              </p>
            </>
          ) : (
            <>
              <UploadIcon className="size-6 text-muted-foreground" aria-hidden />
              <p className="text-[15px]">Drop a video here</p>
              <p className="text-[13px] text-muted-foreground">MP4, MOV or WebM, up to 2 GB</p>
            </>
          )}
          <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={busy}>
            {file ? "Choose another" : "Choose file"}
          </Button>
          <input ref={inputRef} type="file" accept="video/*" className="sr-only" onChange={(e) => pickFile(e.target.files?.[0])} aria-label="Video file" />
          {fileError && <p className="text-sm text-destructive">{fileError}</p>}
        </div>
        {meta && (
          <div className="mt-6">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm font-medium">Thumbnail</p>
              <button type="button" className="text-[13px] text-secondary underline-offset-4 hover:underline disabled:opacity-50" onClick={() => thumbInputRef.current?.click()} disabled={busy}>
                {customThumb ? "Replace your image" : "Upload your own"}
              </button>
              <input ref={thumbInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => pickThumb(e.target.files?.[0])} aria-label="Custom thumbnail image" />
            </div>
            {thumbError && <p className="mt-1 text-[13px] text-destructive">{thumbError}</p>}
            <div role="radiogroup" aria-label="Thumbnail" className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {thumbnails.map((t, i) => (
                <button
                  key={i}
                  role="radio"
                  aria-checked={thumb === i}
                  aria-label={customThumb && i === 0 ? "Your uploaded thumbnail" : `Thumbnail option ${i + 1}`}
                  onClick={() => setThumb(i)}
                  className={cn(
                    "overflow-hidden rounded-md ring-offset-2 ring-offset-background transition-[box-shadow,opacity] duration-200",
                    thumb === i ? "ring-2 ring-secondary" : "opacity-70 hover:opacity-100",
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={t} alt="" className="aspect-video w-full object-cover" />
                </button>
              ))}
            </div>
          </div>
        )}
      </Section>

      <Section n="2" title="Details">
        <div className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="title">Title</Label>
            <Input id="title" value={title} maxLength={140} onChange={(e) => setTitle(e.target.value)} disabled={busy} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" value={description} maxLength={5000} onChange={(e) => setDescription(e.target.value)} disabled={busy} />
          </div>
          <fieldset>
            <legend className="text-sm font-medium">Category</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {CATEGORIES.map((c) => {
                const on = category === c.id;
                return (
                  <label
                    key={c.id}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-md border p-4 transition-[background-color,border-color] duration-200",
                      on ? "border-primary-border bg-tint" : "hover:bg-muted",
                    )}
                  >
                    <input type="radio" name="category" value={c.id} checked={on} onChange={() => setCategory(c.id)} className="mt-1 accent-[hsl(var(--secondary))]" disabled={busy} />
                    <span>
                      <span className="block text-[15px] font-medium">{c.label}</span>
                      <span className="block text-[13px] text-muted-foreground">{c.blurb}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        </div>
      </Section>

      <Section n="3" title="Price per hour of watching">
        <div role="radiogroup" aria-label="Price per hour" className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {PRESETS.map((p) => {
            const on = preset === p;
            return (
              <button
                key={p.toString()}
                role="radio"
                aria-checked={on}
                disabled={busy}
                onClick={() => {
                  setPreset(p);
                  setCustom("");
                }}
                className={cn(
                  "h-12 rounded-md border text-[15px] font-medium tabular transition-[background-color,border-color] duration-200",
                  on ? "border-primary-border bg-primary text-primary-foreground" : "hover:bg-muted",
                )}
              >
                {formatUsdc(p, { suffix: false })}
              </button>
            );
          })}
          <div className="col-span-2 sm:col-span-1">
            <Label htmlFor="custom-price" className="sr-only">
              Custom price per hour in USDC
            </Label>
            <Input
              id="custom-price"
              className={cn("h-12 text-center", preset === null && "border-primary-border")}
              placeholder="Custom"
              inputMode="decimal"
              value={custom}
              disabled={busy}
              onFocus={() => setPreset(null)}
              onChange={(e) => {
                setPreset(null);
                setCustom(e.target.value);
              }}
              aria-invalid={!!priceError && preset === null && !!custom}
              aria-describedby="price-help"
            />
          </div>
        </div>
        <div id="price-help" className="mt-5 min-h-[72px] rounded-md bg-muted/60 p-5 text-[15px]" aria-live="polite">
          {priceError ? (
            <p className="text-destructive">{priceError}</p>
          ) : price ? (
            <div className="space-y-1.5">
              <p>
                Viewers pay <strong className="font-semibold">{formatUsdc(perMinute(price), { decimals: 4 })} a minute</strong>.
                {duration > 0 && (
                  <>
                    {" "}A full watch of this {Math.max(1, Math.round(duration / 60))}-minute video costs <strong className="font-semibold">{formatUsdc(fullCost)}</strong>.
                  </>
                )}
              </p>
              {duration > 0 && (
                <p className="text-muted-foreground">
                  100 viewers watching it all ≈ <strong className="font-semibold text-foreground">{formatUsdc(toCreator)}</strong> to you, after the {PLATFORM_FEE_LABEL} platform fee.
                </p>
              )}
            </div>
          ) : null}
        </div>
      </Section>

      <Section n="4" title="Share and earn">
        <label className="flex cursor-pointer items-start justify-between gap-6 rounded-md border bg-surface p-5">
          <span>
            <span className="block text-[15px] font-medium">Let viewers earn {REFERRAL_LABEL} for sharing this video</span>
            <span className="mt-1 block text-[13px] text-muted-foreground">
              {shareEnabled
                ? `Anyone who has watched it can get a referral link. When people watch through it, the sharer gets ${REFERRAL_LABEL} of what they spend, taken from your share. You keep the rest.`
                : "Off: you keep all earnings. People can still share the plain link, they just don't earn from it."}
            </span>
          </span>
          <span className="mt-1">
            <Switch checked={shareEnabled} onChange={setShareEnabled} disabled={busy} label="Share and earn" />
          </span>
        </label>
      </Section>

      <div className="space-y-3 border-t pt-8">
        {phase.k === "failed" && (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            {phase.message}
            {uploaded.current && " Your upload is saved, so retrying won't upload it again."}
          </p>
        )}
        <PublishStatus phase={phase} />
        {phase.k === "held" || phase.k === "blocked" ? (
          <ReviewOutcome review={phase.review} watchHref={watchHref} onExplain={explain} />
        ) : (
          <Button size="lg" className="w-full sm:w-auto" disabled={!valid || busy} onClick={publish}>
            {busy && <ReloadIcon className="animate-spin" />}
            {phase.k === "uploading"
              ? `Uploading ${phase.pct}%`
              : phase.k === "checking"
                ? "Checking originality…"
                : phase.k === "wallet"
                  ? "Confirm in wallet…"
                  : phase.k === "pending"
                    ? "Pending…"
                    : phase.k === "saving"
                      ? "Saving…"
                      : phase.k === "failed"
                        ? "Try again"
                        : "Publish"}
          </Button>
        )}
      </div>
    </div>
  );
}

function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`step-${n}`}>
      <h2 id={`step-${n}`} className="mb-4 flex items-baseline gap-3 text-[20px] font-semibold">
        <span className="text-[15px] font-medium text-muted-foreground tabular">{n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Queue the upload for the originality check and wait for the worker's verdict. */
async function checkOriginality(
  upload: { contentCid: string; playbackUrl: string; uploadRef?: string; title: string; description: string; durationSeconds: number },
  onUpdate: (r: ReviewRow) => void,
): Promise<ReviewRow> {
  let { review } = await api<{ review: ReviewRow }>("/api/reviews", { method: "POST", json: upload });
  while (review.status === "queued") {
    onUpdate(review);
    await new Promise((r) => setTimeout(r, 4000));
    ({ review } = await api<{ review: ReviewRow }>(`/api/reviews/${encodeURIComponent(review.id)}`));
  }
  if (review.status === "failed") throw new Error(`We couldn't check this video${review.error ? `: ${review.error}` : ""}. Try again.`);
  return review;
}

function ReviewOutcome({ review, watchHref, onExplain }: { review: ReviewRow; watchHref: (id: string) => string; onExplain: (note: string) => Promise<void> }) {
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const blocked = review.status === "blocked";
  return (
    <div role="status" className={cn("space-y-4 rounded-md border p-5 text-[15px]", blocked ? "border-destructive/30 bg-destructive/5" : "bg-muted/60")}>
      <div>
        <p className="font-semibold">{blocked ? "This video matches one already on PayPerWatch" : `Originality score: ${review.score}/100`}</p>
        <p className="mt-1 text-muted-foreground">
          {blocked
            ? "Large parts of its picture or sound are the same as the video below, so it can't be published. If you made the original, contact us with proof."
            : "It covers a lot of the same ground as the videos below. Tell viewers what yours adds, and it will be published with your note."}
        </p>
      </div>
      {review.matches.length > 0 && (
        <ul className="space-y-1.5">
          {review.matches.map((m) => (
            <li key={m.content_cid} className="flex flex-wrap items-baseline justify-between gap-x-4 text-sm">
              {m.video_id ? (
                <Link className="text-secondary underline-offset-4 hover:underline" href={watchHref(m.video_id)} target="_blank">
                  {m.title}
                </Link>
              ) : (
                <span>{m.title}</span>
              )}
              <span className="text-muted-foreground tabular">
                {Math.round(m.similarity * 100)}% {m.kind === "copy" ? "same footage" : "same topic"}
              </span>
            </li>
          ))}
        </ul>
      )}
      {!blocked && (
        <div className="space-y-2">
          <Label htmlFor="review-note">What does your video add?</Label>
          <Textarea
            id="review-note"
            value={note}
            maxLength={NOTE_MAX}
            placeholder="For example: worked examples on live charts, a different method, more depth on one part"
            onChange={(e) => setNote(e.target.value)}
            disabled={sending}
          />
          {note.trim().length < NOTE_MIN && <p className="text-[13px] text-muted-foreground">At least {NOTE_MIN} characters.</p>}
          <Button
            disabled={note.trim().length < NOTE_MIN || sending}
            onClick={async () => {
              setSending(true);
              await onExplain(note.trim());
              setSending(false);
            }}
          >
            {sending && <ReloadIcon className="animate-spin" />}
            Publish with this note
          </Button>
        </div>
      )}
    </div>
  );
}

function PublishStatus({ phase }: { phase: Phase }) {
  if (phase.k === "checking") {
    return (
      <p className="text-sm text-muted-foreground">
        Checking that this video is original: comparing its picture, sound and speech with every video on PayPerWatch. Long videos can take
        a few minutes, so keep this tab open.
      </p>
    );
  }
  if (phase.k === "uploading") {
    return (
      <div className="space-y-1.5">
        <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={phase.pct} aria-valuemin={0} aria-valuemax={100} aria-label="Upload progress">
          <div className="h-full origin-left bg-secondary transition-transform duration-300 ease-apple" style={{ transform: `scaleX(${phase.pct / 100})` }} />
        </div>
        <p className="text-[13px] text-muted-foreground">Uploading your video…</p>
      </div>
    );
  }
  if (phase.k === "pending" || phase.k === "saving") {
    const link = explorerTx(phase.hash);
    return (
      <p className="text-sm text-muted-foreground">
        {phase.k === "pending" ? "Registering on Arc…" : "Confirmed onchain. Saving details…"}{" "}
        {link && (
          <a className="text-secondary underline-offset-4 hover:underline" href={link} target="_blank" rel="noopener noreferrer">
            View transaction
          </a>
        )}
      </p>
    );
  }
  return null;
}
