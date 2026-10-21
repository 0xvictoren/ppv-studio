import Link from "next/link";
import { RatingBadge } from "@/components/rating";
import type { VideoDTO } from "@/lib/client/hooks";
import { categoryLabel } from "@/lib/categories";
import { formatDuration, formatUsdc, perMinute, shortAddress } from "@/lib/money";

export function PriceTag({ pricePerHour, className }: { pricePerHour: bigint; className?: string }) {
  return (
    <span className={`tabular text-sm ${className ?? ""}`}>
      <span className="font-medium text-foreground">{formatUsdc(pricePerHour, { suffix: false })}/hr</span>
      <span className="text-muted-foreground"> · {formatUsdc(perMinute(pricePerHour), { suffix: false, decimals: 3 })}/min</span>
    </span>
  );
}

export function VideoCard({ video, href }: { video: VideoDTO; href: string }) {
  const price = BigInt(video.price_per_hour);
  return (
    <Link
      href={href}
      className="group block rounded-lg outline-offset-4"
      aria-label={`${video.title}. ${categoryLabel(video.category)}. ${formatDuration(video.duration_seconds)}. ${formatUsdc(price)} per hour.`}
    >
      <div className="relative aspect-video overflow-hidden rounded-lg bg-muted">
        {video.thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={video.thumbnail_url}
            alt=""
            loading="lazy"
            className="size-full object-cover transition-transform duration-500 ease-apple group-hover:scale-[1.02]"
          />
        ) : (
          <div className="grid size-full place-items-center text-sm text-muted-foreground">No preview</div>
        )}
        <span className="absolute bottom-2 right-2 rounded-[6px] bg-black/65 px-1.5 py-0.5 text-xs font-medium text-white tabular backdrop-blur-sm">
          {formatDuration(video.duration_seconds)}
        </span>
      </div>
      <div className="mt-3 space-y-1">
        <h3 className="line-clamp-2 text-[15px] font-medium leading-snug">{video.title}</h3>
        <p className="text-[13px] text-muted-foreground">
          {categoryLabel(video.category)} · <span className="font-mono text-[12px]">{shortAddress(video.creator)}</span>
        </p>
        <div className="flex items-center justify-between gap-3">
          <PriceTag pricePerHour={price} />
          <RatingBadge rating={video.rating} raters={video.raters} />
        </div>
      </div>
    </Link>
  );
}
