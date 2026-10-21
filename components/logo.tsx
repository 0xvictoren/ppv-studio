export function Logo({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
        <rect x="1" y="1" width="22" height="22" rx="7" fill="hsl(var(--primary))" stroke="hsl(var(--primary-border))" />
        <path d="M10 7.8v8.4a.6.6 0 0 0 .9.5l6.6-4.2a.6.6 0 0 0 0-1L10.9 7.3a.6.6 0 0 0-.9.5Z" fill="hsl(var(--primary-foreground))" />
      </svg>
      <span className="font-display text-[17px] font-semibold tracking-[-0.02em]">PayPerWatch</span>
    </span>
  );
}
