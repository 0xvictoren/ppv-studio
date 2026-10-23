import type { Metadata } from "next";
import { CopyCode } from "@/components/copy-code";
import { PageTitle } from "@/components/ui/primitives";
import { env, isTestnet } from "@/lib/env";

export const metadata: Metadata = { title: "Embed on your site" };

export default function DevelopersPage() {
  const host = env.appUrl;
  const one = `<script src="${host}/embed.js" data-ppw="catalog" async></script>`;
  const options = [
    {
      title: "A single video",
      body: "Drop one video into an article, course page or landing page. Viewers connect a wallet and pay per second right there.",
      code: `<div data-ppw="video" data-video="0xYOUR_VIDEO_ID"></div>\n<script src="${host}/embed.js" async></script>`,
    },
    {
      title: "A catalog",
      body: "Your whole library, or one category. Filter by creator to show only your own videos.",
      code: `<div data-ppw="catalog" data-category="tutorials" data-creator="0xYOUR_WALLET"></div>\n<script src="${host}/embed.js" async></script>`,
    },
    {
      title: "Earn as a platform",
      body: "Add your wallet as the referrer and earn 5% of what viewers you bring in spend, paid from the creator's share every hour. Your wallet must have watched that creator's content once.",
      code: `<div data-ppw="catalog" data-ref="0xYOUR_WALLET"></div>
<script src="${host}/embed.js" async></script>`,
    },
    {
      title: "Uploads",
      body: "Let your users publish to PayPerWatch from your site. They choose the category and set their own price.",
      code: `<div data-ppw="upload"></div>\n<script src="${host}/embed.js" async></script>`,
    },
    {
      title: "Plain iframe",
      body: "No script needed. Use this when your platform only accepts iframes.",
      code: `<iframe src="${host}/embed/watch/0xYOUR_VIDEO_ID"\n  style="width:100%;height:640px;border:0" allow="fullscreen; clipboard-write" allowfullscreen></iframe>`,
    },
  ];
  const agentSearch = `${host}/api/agent/search?q=fibonacci+retracement`;
  const agentPay = `import { GatewayClient } from "@circle-fin/x402-batching/client";

const agent = new GatewayClient({ chain: "${isTestnet ? "arcTestnet" : "arc"}", privateKey: AGENT_KEY });
await agent.deposit("1"); // once: fund the agent's Gateway balance

const { results } = await (await fetch("${host}/api/agent/search?q=fibonacci")).json();
const { data } = await agent.pay(results[0].transcript.url);
console.log(data.transcript);`;

  return (
    <div className="container max-w-4xl">
      <PageTitle
        title="Embed on your site"
        subtitle="Add pay-per-second video to any website. No backend, no API keys: payments go straight from your viewers to the creator on Arc."
      />

      <section aria-labelledby="one-line" className="rounded-xl border bg-surface p-8">
        <h2 id="one-line" className="text-[20px] font-semibold">
          The one-line version
        </h2>
        <p className="mt-2 text-[15px] text-muted-foreground">Paste this where you want the catalog to appear.</p>
        <CopyCode code={one} className="mt-5" />
      </section>

      <div className="mt-16 space-y-14">
        {options.map((o) => (
          <section key={o.title} aria-label={o.title} className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
            <div>
              <h2 className="text-[20px] font-semibold">{o.title}</h2>
              <p className="mt-2 text-[15px] text-muted-foreground">{o.body}</p>
            </div>
            <CopyCode code={o.code} />
          </section>
        ))}
      </div>

      <section aria-labelledby="how" className="mt-20 border-t pt-12">
        <h2 id="how" className="text-[20px] font-semibold">
          How it works
        </h2>
        <ul className="mt-4 space-y-3 text-[15px] text-muted-foreground">
          <li>The embed runs in an iframe served from {host}, so your page never handles keys or funds.</li>
          <li>Viewers connect their own wallet inside the embed. Billing, receipts and hourly settlement work exactly as on PayPerWatch.</li>
          <li>The iframe grows and shrinks to fit its content automatically.</li>
          <li>Find a video&apos;s ID in the creator dashboard, where each video has a ready-to-copy embed code.</li>
          <li>Signing in to upload from inside an embed needs third-party cookies over https. If a browser blocks them, the embed offers to open in a new tab.</li>
        </ul>
      </section>

      <section aria-labelledby="agents" className="mt-20 border-t pt-12">
        <h2 id="agents" className="text-[20px] font-semibold">
          For AI agents
        </h2>
        <p className="mt-2 text-[15px] text-muted-foreground">
          Give your agent this endpoint. It can search every video for free, then buy a full timestamped transcript with USDC over x402 (Circle Gateway
          nanopayments). The creator is paid for every purchase, just like a viewer.
        </p>
        <CopyCode code={agentSearch} className="mt-5" />
        <div className="mt-10 grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
          <div>
            <h3 className="text-[17px] font-semibold">Buying a transcript</h3>
            <p className="mt-2 text-[15px] text-muted-foreground">
              Each search result has a <code className="text-foreground">transcript.url</code> and its price, which is what a person pays to watch the whole
              video. Requesting it without payment returns <code className="text-foreground">402 Payment Required</code> with the payment details; any
              x402 client with a Gateway balance on Arc pays and retries automatically.
            </p>
          </div>
          <CopyCode code={agentPay} />
        </div>
      </section>

      <section aria-labelledby="preview" className="mt-20">
        <h2 id="preview" className="text-[20px] font-semibold">
          Live preview
        </h2>
        <p className="mt-2 text-[15px] text-muted-foreground">This is the catalog embed, exactly as it appears on another site.</p>
        <div className="mt-6 overflow-hidden rounded-xl border">
          <iframe src="/embed/browse" title="PayPerWatch catalog embed preview" className="block h-[720px] w-full border-0" allow="fullscreen; clipboard-write" />
        </div>
      </section>
    </div>
  );
}
