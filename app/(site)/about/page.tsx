import { ExternalLinkIcon } from "@radix-ui/react-icons";
import type { Metadata } from "next";
import { BillingExplainer } from "@/components/billing-explainer";
import { StatsStrip } from "@/components/stats-strip";
import { PageTitle } from "@/components/ui/primitives";
import { env, explorerAddress, isTestnet } from "@/lib/env";

export const metadata: Metadata = { title: "About" };

export default function AboutPage() {
  const contractLink = explorerAddress(env.ppwAddress);
  return (
    <div className="container max-w-3xl">
      <PageTitle title="Never pay for time you didn't watch." subtitle="PayPerWatch is video you pay for by the second, in USDC, only while it plays." />

      <div className="space-y-16">
        <section aria-labelledby="problem">
          <h2 id="problem" className="text-[22px] font-semibold">
            The problem
          </h2>
          <p className="mt-3 text-[17px] text-muted-foreground">
            Subscriptions charge the same whether you watch 40 hours or none. Pay-per-view charges for a whole film when you only
            wanted ten minutes. And card fees make anything under about a dollar uneconomic for independent creators.
          </p>
        </section>

        <section aria-labelledby="solution">
          <h2 id="solution" className="text-[22px] font-semibold">
            How PayPerWatch fixes it
          </h2>
          <ul className="mt-3 space-y-2 text-[17px] text-muted-foreground">
            <li>Creators set a price per hour. Viewers deposit a few dollars of USDC into a smart contract.</li>
            <li>Your browser meters real playback and signs a running total with a temporary, spend-capped key. No popups.</li>
            <li>Every hour the totals are settled onchain in one batch, and creators are paid directly.</li>
            <li>Unused USDC can always be withdrawn. The 24-hour wait only lets your final minutes settle first.</li>
          </ul>
        </section>

        <section aria-labelledby="arc">
          <h2 id="arc" className="text-[22px] font-semibold">
            Why Arc
          </h2>
          <dl className="mt-5 grid gap-6 sm:grid-cols-3">
            {[
              ["USDC is the gas", "Viewers and creators only ever hold USDC. There's no second token to buy just to pay fees."],
              ["Sub-second finality", "A deposit confirms before the video starts, so adding funds and pressing play feels instant."],
              ["Tiny, stable fees", "Settling cents for every viewer every hour only works when fees are a fraction of a cent."],
            ].map(([t, b]) => (
              <div key={t} className="border-t pt-4">
                <dt className="font-medium">{t}</dt>
                <dd className="mt-1 text-[15px] text-muted-foreground">{b}</dd>
              </div>
            ))}
          </dl>
        </section>

        <BillingExplainer />

        <section aria-labelledby="contract" id="contract" className="space-y-6">
          <h2 className="text-[22px] font-semibold">Live on {isTestnet ? "Arc Testnet" : "Arc"}</h2>
          <StatsStrip />
          <div className="rounded-lg border bg-surface p-6 text-[15px]">
            <p className="text-[13px] text-muted-foreground">Contract</p>
            <p className="mt-1 break-all font-mono text-[13px]">{env.ppwAddress}</p>
            {contractLink && (
              <a href={contractLink} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-secondary underline-offset-4 hover:underline">
                View the contract and every transaction <ExternalLinkIcon />
              </a>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
