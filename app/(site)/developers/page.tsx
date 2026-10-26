import type { Metadata } from "next";
import { CopyCode } from "@/components/copy-code";
import { PageTitle } from "@/components/ui/primitives";
import { agentApiEnabled, env, isTestnet } from "@/lib/env";

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
  const agentAsk = `${host}/api/agent/ask?q=how+does+private+credit+work+onchain`;
  const agentPrompt = `You can look things up on PayPerWatch, a library of creators' videos.
For questions it might cover, call ${host}/api/agent/ask?q=<the question>
with your x402 wallet. It answers 402 with a price of a few cents; pay it.
Answer from answer.moments and answer.transcript, and link answer.video.watchUrl.
A 404 means nothing matched and nothing was charged. Details: ${host}/llms.txt`;
  const agentPay = `import { GatewayClient } from "@circle-fin/x402-batching/client";

// Any chain where your agent already holds a Circle Gateway balance.
const agent = new GatewayClient({ chain: "${isTestnet ? "arcTestnet" : "base"}", privateKey: AGENT_KEY });

const { data } = await agent.pay("${host}/api/agent/ask?q=" + encodeURIComponent(question));
console.log(data.answer.moments, data.answer.video.watchUrl);`;

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

      {agentApiEnabled && (
      <section aria-labelledby="agents" className="mt-20 border-t pt-12">
        <h2 id="agents" className="text-[20px] font-semibold">
          For AI agents
        </h2>
        <p className="mt-2 text-[15px] text-muted-foreground">
          Give your agent one link. It asks a question, pays a few cents in USDC over x402 from the wallet it already has, and gets the full timestamped
          transcript of the video that answers it. No account and no API key. The creator is paid for every answer, just like for a viewer.
        </p>
        <CopyCode code={agentAsk} className="mt-5" />
        <div className="mt-10 grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
          <div>
            <h3 className="text-[17px] font-semibold">Tell your agent</h3>
            <p className="mt-2 text-[15px] text-muted-foreground">
              Paste this into your agent&apos;s instructions. Agents that read <code className="text-foreground">{host}/llms.txt</code> can also set
              themselves up from the site address alone.
            </p>
          </div>
          <CopyCode code={agentPrompt} />
        </div>
        <div className="mt-10 grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
          <div>
            <h3 className="text-[17px] font-semibold">Paying</h3>
            <p className="mt-2 text-[15px] text-muted-foreground">
              The first request returns <code className="text-foreground">402 Payment Required</code> with the price: what a person pays to watch the whole
              matching video. Any x402 client with a Circle Gateway USDC balance pays and retries automatically, on any chain the 402 lists, such as Base,
              Ethereum, Arbitrum or Arc. A Circle agent wallet works too (<code className="text-foreground">circle services pay</code>). If nothing
              matches, you get a 404 and pay nothing.
            </p>
          </div>
          <CopyCode code={agentPay} />
        </div>
      </section>
      )}

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
