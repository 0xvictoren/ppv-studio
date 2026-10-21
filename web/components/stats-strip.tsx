"use client";

import { Skeleton } from "@/components/ui/primitives";
import { useStats } from "@/lib/client/hooks";
import { formatUsdc } from "@/lib/money";

export function StatsStrip() {
  const { data } = useStats();
  const items = [
    { label: "Paid to creators", value: data ? formatUsdc(BigInt(data.totalSettled), { suffix: false }) : null },
    { label: "Minutes watched", value: data ? data.minutesWatched.toLocaleString() : null },
    { label: "Creators paid", value: data ? data.creatorsPaid.toLocaleString() : null },
    { label: "Deposited by viewers", value: data ? formatUsdc(BigInt(data.totalDeposited), { suffix: false }) : null },
  ];
  return (
    <section aria-label="Live activity on Arc">
      <dl className="grid grid-cols-2 gap-y-8 md:grid-cols-4">
        {items.map((i) => (
          <div key={i.label} className="border-l pl-5">
            <dt className="text-[13px] text-muted-foreground">{i.label}</dt>
            {/* Fixed height so loading → loaded never shifts the layout. */}
            <dd className="mt-1 h-9 font-display text-[28px] font-semibold tabular">{i.value ?? <Skeleton className="h-8 w-24" />}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-6 text-[13px] text-muted-foreground">Live from the PayPerWatch contract on Arc. All figures in USDC.</p>
    </section>
  );
}
