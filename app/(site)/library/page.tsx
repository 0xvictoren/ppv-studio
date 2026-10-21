"use client";

import { ArrowLeftIcon, TrashIcon } from "@radix-ui/react-icons";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState, PageTitle, Skeleton } from "@/components/ui/primitives";
import { deleteOffline, listOffline, type OfflineVideo } from "@/lib/client/offline";
import { categoryLabel } from "@/lib/categories";
import { formatDuration } from "@/lib/money";

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "long", day: "numeric" });

export default function LibraryPage() {
  const [items, setItems] = useState<OfflineVideo[] | null>(null);
  const [expired, setExpired] = useState<string[]>([]);
  const [playing, setPlaying] = useState<OfflineVideo | null>(null);
  const [offline, setOffline] = useState(false);

  const refresh = () =>
    listOffline()
      .then(([kept, gone]) => {
        setItems(kept);
        if (gone.length) setExpired(gone);
      })
      .catch(() => setItems([]));

  useEffect(() => {
    void refresh();
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const totalMb = useMemo(() => Math.round((items ?? []).reduce((a, v) => a + v.bytes, 0) / 1e6), [items]);

  if (playing) return <OfflinePlayer video={playing} onBack={() => setPlaying(null)} />;

  return (
    <div className="container">
      <PageTitle
        title="Downloads"
        subtitle="Videos you bought for offline viewing. They play here in PayPerWatch, even without a connection, until your 30-day pass ends."
      />
      {offline && <p className="mb-6 rounded-md bg-tint px-4 py-3 text-[13px] text-muted-foreground">You&apos;re offline. Your downloads still play.</p>}
      {expired.length > 0 && (
        <p className="mb-6 rounded-md bg-tint px-4 py-3 text-[13px] text-muted-foreground">
          Removed because the 30-day pass ended: {expired.join(", ")}. Watch again on PayPerWatch any time.
        </p>
      )}
      {items === null ? (
        <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="aspect-video w-full rounded-lg" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState title="No downloads yet" body="Open a video and choose Download. You pay the rest of its price once, then it's yours offline for 30 days.">
          <Button asChild>
            <Link href="/videos">Browse videos</Link>
          </Button>
        </EmptyState>
      ) : (
        <>
          <p className="mb-6 text-[13px] text-muted-foreground tabular">
            {items.length} {items.length === 1 ? "video" : "videos"} · {totalMb} MB on this device
          </p>
          <ul className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((v) => (
              <li key={v.videoId}>
                <button onClick={() => setPlaying(v)} className="group block w-full text-left" aria-label={`Play ${v.title}`}>
                  <div className="relative aspect-video overflow-hidden rounded-lg bg-muted">
                    {v.thumbnail && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={v.thumbnail} alt="" className="size-full object-cover transition-transform duration-500 ease-apple group-hover:scale-[1.02]" />
                    )}
                    <span className="absolute bottom-2 right-2 rounded-[6px] bg-black/65 px-1.5 py-0.5 text-xs font-medium text-white tabular">
                      {formatDuration(v.durationSeconds)}
                    </span>
                  </div>
                  <h3 className="mt-3 line-clamp-2 text-[15px] font-medium">{v.title}</h3>
                </button>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <p className="text-[13px] text-muted-foreground">
                    {categoryLabel(v.category)} · offline until {fmtDate(v.passUntil)}
                  </p>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 text-muted-foreground"
                    aria-label={`Delete ${v.title} from this device`}
                    onClick={async () => {
                      await deleteOffline(v.videoId);
                      void refresh();
                    }}
                  >
                    <TrashIcon />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-10 text-[13px] text-muted-foreground">
            Deleted something by mistake? Download it again from its video page. It&apos;s free until the pass ends.
          </p>
        </>
      )}
    </div>
  );
}

function OfflinePlayer({ video, onBack }: { video: OfflineVideo; onBack: () => void }) {
  const url = useMemo(() => URL.createObjectURL(video.blob), [video.blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return (
    <div className="container max-w-5xl pt-8">
      <button onClick={onBack} className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors duration-200 hover:text-foreground">
        <ArrowLeftIcon /> Downloads
      </button>
      <div className="aspect-video w-full overflow-hidden rounded-lg border bg-black" onContextMenu={(e) => e.preventDefault()}>
        <video src={url} className="size-full" controls controlsList="nodownload" playsInline autoPlay aria-label={video.title} />
      </div>
      <h1 className="mt-6 font-display text-[26px] font-semibold">{video.title}</h1>
      <p className="mt-2 text-[13px] text-muted-foreground">Paid for. Plays offline until {fmtDate(video.passUntil)}.</p>
    </div>
  );
}
