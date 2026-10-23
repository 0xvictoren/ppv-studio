import { readFileSync } from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import { headings, Markdown } from "@/components/markdown";
import { PageTitle } from "@/components/ui/primitives";
import { agentApiEnabled, env, isTestnet } from "@/lib/env";
import { reviewEnabled } from "@/lib/server/review";

export const metadata: Metadata = { title: "Manual" };
// Built once from MANUAL.md at the repo root, the single source for this page.
export const dynamic = "force-static";

export default function ManualPage() {
  // The manual names the public site; show this deployment's own address instead.
  const source = forThisSite(readFileSync(path.join(process.cwd(), "MANUAL.md"), "utf8")).replaceAll("https://ppv-studio.vercel.app", env.appUrl);
  const toc = headings(source);
  return (
    <div className="container">
      <PageTitle title="Manual" subtitle="How to use every part of PayPerWatch: watching, paying, downloads, sharing, publishing, embeds and agents." />
      <div className="grid gap-12 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Manual sections" className="lg:sticky lg:top-24 lg:max-h-[calc(100vh-8rem)] lg:self-start lg:overflow-y-auto">
          <p className="text-[13px] font-medium text-foreground">On this page</p>
          <ol className="mt-3 space-y-1.5 border-l text-[14px]">
            {toc.map((h) => (
              <li key={h.id}>
                <a href={`#${h.id}`} className="-ml-px block border-l border-transparent pl-3 text-muted-foreground transition-colors duration-200 hover:border-foreground hover:text-foreground">
                  {h.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <article className="max-w-3xl">
          <Markdown source={source} />
        </article>
      </div>
    </div>
  );
}

/** Keeps the `<!-- if:name -->…<!-- end -->` blocks that apply to this deployment and drops the rest. */
function forThisSite(md: string) {
  const on: Record<string, boolean> = { testnet: isTestnet, mainnet: !isTestnet, review: reviewEnabled(), agents: agentApiEnabled };
  return md.replace(/<!-- if:(\w+) -->\r?\n([\s\S]*?)<!-- end -->(\r?\n)?/g, (_, name: string, body: string) => (on[name] ? body : ""));
}
