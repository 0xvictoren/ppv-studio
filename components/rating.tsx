import { cn } from "@/lib/utils";

/** Compact watch-based rating: one filled star plus the number, Apple App Store style. */
export function RatingBadge({ rating, raters, className }: { rating: number | null; raters: number; className?: string }) {
  if (rating === null) return <span className={cn("text-[13px] text-muted-foreground", className)}>New</span>;
  return (
    <span className={cn("inline-flex items-center gap-1 text-[13px] tabular", className)} aria-label={`Rated ${rating.toFixed(1)} out of 5 by ${raters} viewers`}>
      <Star filled className="size-3.5 text-secondary" />
      <span className="font-medium text-foreground">{rating.toFixed(1)}</span>
      <span className="text-muted-foreground">({raters})</span>
    </span>
  );
}

/** Five stars with fractional fill, for the watch page. */
export function RatingStars({ rating, className }: { rating: number; className?: string }) {
  return (
    <span className={cn("relative inline-flex", className)} aria-hidden>
      <span className="flex text-border">
        {Array.from({ length: 5 }, (_, i) => (
          <Star key={i} filled className="size-4" />
        ))}
      </span>
      <span className="absolute inset-0 flex overflow-hidden text-secondary" style={{ width: `${(rating / 5) * 100}%` }}>
        {Array.from({ length: 5 }, (_, i) => (
          <Star key={i} filled className="size-4 shrink-0" />
        ))}
      </span>
    </span>
  );
}

function Star({ filled, className }: { filled?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={filled ? 0 : 1.2}>
      <path d="M8 1.2l2.03 4.3 4.67.6-3.44 3.24.87 4.63L8 11.7l-4.13 2.27.87-4.63L1.3 6.1l4.67-.6L8 1.2z" />
    </svg>
  );
}
