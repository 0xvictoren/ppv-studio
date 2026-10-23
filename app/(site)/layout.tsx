import Link from "next/link";
import { Header } from "@/components/header";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <Header />
      <main id="main">{children}</main>
      <footer className="mt-24 border-t">
        <div className="container grid gap-8 py-12 text-sm text-muted-foreground md:grid-cols-[2fr_1fr_1fr_1fr]">
          <div>
            <p className="font-medium text-foreground">PayPerWatch</p>
            <p className="mt-2 max-w-xs">Pay by the second, in USDC, only while the video plays. Running on Arc Testnet.</p>
          </div>
          <FooterCol title="Watch" links={[["Browse", "/videos"], ["Spendings", "/wallet"], ["How billing works", "/about"], ["Manual", "/manual"]]} />
          <FooterCol title="Create" links={[["Upload", "/upload"], ["Dashboard", "/dashboard"]]} />
          <FooterCol title="Build" links={[["Embed on your site", "/developers"], ["Contract", "/about#contract"]]} />
        </div>
      </footer>
    </>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <nav aria-label={title}>
      <p className="font-medium text-foreground">{title}</p>
      <ul className="mt-2 space-y-1.5">
        {links.map(([label, href]) => (
          <li key={href}>
            <Link href={href} className="transition-colors duration-200 hover:text-foreground">
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
