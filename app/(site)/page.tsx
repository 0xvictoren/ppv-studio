import { ArrowRightIcon, PlusIcon } from "@radix-ui/react-icons";
import Link from "next/link";
import { PhotoCredit } from "@/components/photo-credit";
import { StatsStrip } from "@/components/stats-strip";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/ui/reveal";
import { CATEGORIES } from "@/lib/categories";
import { env, isTestnet } from "@/lib/env";
import { HERO_PHOTO, REELS_PHOTO } from "@/lib/unsplash";

const STEPS = [
  ["Add a few dollars", "Deposit USDC once. A single confirmation covers 24 hours of watching, with no popups."],
  ["Watch by the second", "The meter runs only while the video plays. Pause, look away or close the tab, and it stops."],
  ["Keep what's left", "Unused USDC is yours. Withdraw it whenever you like."],
];

const FAQ = [
  ["Do I need crypto experience?", "You need a wallet and some USDC. On Arc, USDC also pays the network fee, so there's no second token to buy."],
  ["What does a video cost?", "Each creator sets a price per hour. A $1/hr video costs under 2¢ a minute, and you only pay for the minutes you play."],
  ["Do I pay again if I rewatch?", "No. You pay for each second of a video once. Come back after a break and billing picks up where new footage starts. Finish a video and replays are free for 30 days."],
  ["Can I download videos?", "Yes, inside the app, to watch offline. You pay only the part you haven't watched yet, and you can delete and re-download it free for 30 days."],
  ["When do creators get paid?", "As you watch: payments settle onchain when a viewer reaches 10%, 25%, 50%, 75% and 100% of a video, plus a sweep every hour. Earnings go straight to the creator's wallet, minus a 5% platform fee."],
  ["Can I get my money back?", "Anything you haven't watched stays in your balance. Request a withdrawal and it's ready 24 hours later, once your last minutes are settled."],
  isTestnet
    ? ["Is this real money?", "PayPerWatch currently runs on Arc Testnet with free test USDC from Circle's faucet. Nothing you do here costs real money."]
    : ["Is this real money?", "Yes. PayPerWatch runs on Arc mainnet with real USDC. Only deposit what you plan to watch with; anything unspent can be withdrawn."],
];

export default function Home() {
  const snippet = `<script src="${env.appUrl}/embed.js" data-ppw="catalog" async></script>`;
  return (
    <>
      {/* Hero */}
      <section className="relative isolate overflow-hidden bg-[#14110E]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={HERO_PHOTO.src}
          srcSet={HERO_PHOTO.srcSet}
          sizes="100vw"
          alt={HERO_PHOTO.alt}
          fetchPriority="high"
          className="absolute inset-0 -z-10 size-full object-cover opacity-70 [filter:sepia(0.35)_saturate(0.7)_brightness(0.85)]"
        />
        <div className="absolute inset-0 -z-10 bg-[#14110E]/45" aria-hidden />
        <div className="container flex min-h-[78vh] flex-col items-center justify-center py-24 text-center text-[#F3EEE4]">
          <p className="animate-[fadeIn_600ms_ease] text-[15px] text-[#F3EEE4]/75">Movies, tutorials and exclusive videos</p>
          <h1 className="mt-4 max-w-4xl animate-[fadeIn_800ms_ease] font-display text-[44px] font-semibold leading-[1.05] tracking-[-0.03em] md:text-[72px]">
            Pay only for what you watch.
          </h1>
          <p className="mt-6 max-w-xl animate-[fadeIn_1000ms_ease] text-[17px] text-[#F3EEE4]/80 md:text-[19px]">
            Creators set a price per hour. You pay by the second in USDC, and anything you don&apos;t watch stays yours.
          </p>
          <div className="mt-10 flex animate-[fadeIn_1100ms_ease] flex-wrap justify-center gap-3">
            <Button asChild size="lg" variant="onImage">
              <Link href="/videos">
                Start watching <ArrowRightIcon />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="border-[#F3EEE4]/35 text-[#F3EEE4] hover:bg-[#F3EEE4]/10">
              <Link href="/upload">Upload and earn</Link>
            </Button>
          </div>
        </div>
        <PhotoCredit photo={HERO_PHOTO} className="absolute bottom-3 right-4 text-[11px] text-[#F3EEE4]/55" />
      </section>

      {/* Live stats */}
      <div className="container py-20">
        <Reveal>
          <StatsStrip />
        </Reveal>
      </div>

      {/* How it works */}
      <section className="container py-12" aria-labelledby="how">
        <Reveal>
          <h2 id="how" className="font-display text-[32px] font-semibold md:text-[40px]">
            Simple from the first second.
          </h2>
        </Reveal>
        <ol className="mt-12 grid gap-10 md:grid-cols-3">
          {STEPS.map(([title, body], i) => (
            <Reveal as="li" key={title} index={i} className="border-t pt-6">
              <span className="text-[13px] text-muted-foreground tabular">0{i + 1}</span>
              <h3 className="mt-3 text-[20px] font-semibold">{title}</h3>
              <p className="mt-2 text-[15px] text-muted-foreground">{body}</p>
            </Reveal>
          ))}
        </ol>
      </section>

      {/* Categories */}
      <section className="container py-24" aria-labelledby="cats">
        <Reveal className="flex items-end justify-between gap-4">
          <h2 id="cats" className="font-display text-[32px] font-semibold md:text-[40px]">
            Something for every minute.
          </h2>
          <Link href="/videos" className="hidden items-center gap-1 text-[15px] text-secondary underline-offset-4 hover:underline sm:inline-flex">
            Browse all <ArrowRightIcon />
          </Link>
        </Reveal>
        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {CATEGORIES.map((c, i) => (
            <Reveal key={c.id} index={i}>
              <Link
                href={`/videos?category=${c.id}`}
                className="group flex h-40 flex-col justify-between rounded-lg border bg-surface p-6 transition-[background-color,border-color] duration-300 ease-apple hover:border-primary-border hover:bg-tint"
              >
                <span className="text-[13px] text-muted-foreground">{c.blurb}</span>
                <span className="flex items-center justify-between text-[22px] font-semibold">
                  {c.label}
                  <ArrowRightIcon className="size-5 -translate-x-1 opacity-0 transition-[opacity,transform] duration-300 ease-apple group-hover:translate-x-0 group-hover:opacity-100" />
                </span>
              </Link>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Comparison */}
      <section className="bg-surface py-24" aria-labelledby="compare">
        <div className="container">
          <Reveal>
            <h2 id="compare" className="max-w-2xl font-display text-[32px] font-semibold md:text-[40px]">
              Stop paying for months you didn&apos;t use.
            </h2>
          </Reveal>
          <div className="mt-12 grid gap-4 md:grid-cols-2">
            <Reveal className="rounded-lg border bg-background p-8">
              <p className="text-[15px] text-muted-foreground">A monthly subscription</p>
              <p className="mt-3 font-display text-[56px] font-semibold tabular leading-none">$10.00</p>
              <p className="mt-4 text-[15px] text-muted-foreground">Charged even if you watch nothing this month.</p>
            </Reveal>
            <Reveal index={1} className="rounded-lg border border-primary-border bg-tint p-8">
              <p className="text-[15px] text-muted-foreground">PayPerWatch</p>
              <p className="mt-3 font-display text-[56px] font-semibold tabular leading-none">$0.40</p>
              <p className="mt-4 text-[15px] text-muted-foreground">For the 25 minutes you actually watched.</p>
            </Reveal>
          </div>
        </div>
      </section>

      {/* Creators */}
      <section className="container grid items-center gap-12 py-24 md:grid-cols-2" aria-labelledby="creators">
        <Reveal className="order-2 md:order-1">
          <h2 id="creators" className="font-display text-[32px] font-semibold md:text-[40px]">
            Your work, your price.
          </h2>
          <p className="mt-5 max-w-md text-[17px] text-muted-foreground">
            Upload a film, a course or members-only content and set a price per hour. You&apos;re paid for every second watched,
            automatically, every hour. No claim button and no minimum payout.
          </p>
          <Button asChild size="lg" className="mt-8">
            <Link href="/upload">Upload a video</Link>
          </Button>
        </Reveal>
        <Reveal index={1} className="order-1 md:order-2">
          <figure>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={REELS_PHOTO.src}
              srcSet={REELS_PHOTO.srcSet}
              sizes="(min-width: 768px) 50vw, 100vw"
              alt={REELS_PHOTO.alt}
              loading="lazy"
              className="aspect-[4/3] w-full rounded-xl bg-muted object-cover [filter:sepia(0.15)_saturate(0.85)]"
            />
            <figcaption>
              <PhotoCredit photo={REELS_PHOTO} className="mt-2 text-[11px] text-muted-foreground" />
            </figcaption>
          </figure>
        </Reveal>
      </section>

      {/* Platforms */}
      <section className="container py-24" aria-labelledby="embed">
        <Reveal className="rounded-xl border bg-surface p-8 md:p-12">
          <p className="text-[15px] text-muted-foreground">For platforms</p>
          <h2 id="embed" className="mt-2 max-w-2xl font-display text-[32px] font-semibold md:text-[40px]">
            Add pay-per-second video to your site with one line.
          </h2>
          <p className="mt-4 max-w-xl text-[17px] text-muted-foreground">
            Drop in a single video, your whole catalog or the upload flow. Viewers connect their own wallet right on your page.
          </p>
          <pre className="mt-8 overflow-x-auto rounded-md border bg-background p-4 font-mono text-[13px]">
            <code>{snippet}</code>
          </pre>
          <Button asChild variant="outline" className="mt-6">
            <Link href="/developers">
              See all embed options <ArrowRightIcon />
            </Link>
          </Button>
        </Reveal>
      </section>

      {/* FAQ */}
      <section className="container max-w-3xl py-24" aria-labelledby="faq">
        <Reveal>
          <h2 id="faq" className="font-display text-[32px] font-semibold md:text-[40px]">
            Questions
          </h2>
        </Reveal>
        <div className="mt-10">
          {FAQ.map(([q, a]) => (
            <details key={q} className="group border-b py-5 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-[17px] font-medium">
                {q}
                <PlusIcon className="size-4 shrink-0 text-muted-foreground transition-transform duration-300 ease-apple group-open:rotate-45" aria-hidden />
              </summary>
              <p className="mt-3 animate-[fadeIn_300ms_ease] text-[15px] text-muted-foreground">{a}</p>
            </details>
          ))}
        </div>
      </section>
    </>
  );
}
