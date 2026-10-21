import { PLATFORM_FEE_LABEL } from "@/lib/money";

const POINTS = [
  ["Each second, once", "You pay for a second of a video the first time you watch it. Stop at minute 30, come back later, and billing picks up at minute 31. Rewatching parts you've seen is free."],
  ["Finish it, replay free", "Once you've watched a video to the end, every replay is free for 30 days from when you first started it."],
  ["Only while it plays", "You're billed only while the video is actually playing, never while paused or buffering. We never pause it for you, not when you switch tabs and not during long sessions, so pause it yourself when you step away."],
  ["Paid as you go", "Payments settle on-chain at 10%, 25%, 50%, 75% and 100% of a video, and every hour. The creator is paid directly."],
  ["Downloads", "Save a video to watch offline in the app. You pay only the part you haven't watched yet, and re-downloads are free for 30 days."],
  ["Your money stays yours", `A ${PLATFORM_FEE_LABEL} platform fee comes out of the creator's share, never on top of your price. Withdraw unused USDC whenever you like.`],
];

export function BillingExplainer() {
  return (
    <section aria-labelledby="billing" className="rounded-lg border bg-surface p-6">
      <h2 id="billing" className="text-[17px] font-semibold">
        How billing works
      </h2>
      <dl className="mt-4 space-y-4">
        {POINTS.map(([t, b]) => (
          <div key={t}>
            <dt className="text-sm font-medium">{t}</dt>
            <dd className="mt-0.5 text-sm text-muted-foreground">{b}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
