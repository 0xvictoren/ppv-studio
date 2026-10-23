"use client";

import { Cross2Icon, HamburgerMenuIcon, MoonIcon, SunIcon, UploadIcon } from "@radix-ui/react-icons";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { ConnectButton } from "@/components/connect-button";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/wallet", label: "Spendings" },
  { href: "/videos", label: "Browse" },
  { href: "/library", label: "Downloads" },
  { href: "/developers", label: "Developers" },
  { href: "/manual", label: "Manual" },
];

export function Header() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);

  return (
    <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur-xl backdrop-saturate-150">
      <div className="container flex h-[60px] items-center gap-6">
        <Link href="/" aria-label="PayPerWatch home" className="shrink-0">
          <Logo />
        </Link>
        <nav className="hidden items-center gap-1 lg:flex" aria-label="Main">
          {NAV.map((n) => {
            const active = path.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm transition-colors duration-200",
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-1.5">
          <Button asChild size="sm" variant={path.startsWith("/upload") ? "secondary" : "outline"} className="gap-1.5">
            <Link href="/upload" aria-label="Upload a video">
              <UploadIcon />
              <span className="hidden sm:inline">Upload</span>
            </Link>
          </Button>
          <ThemeToggle />
          <ConnectButton />
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen((o) => !o)} aria-label="Menu" aria-expanded={open}>
            {open ? <Cross2Icon /> : <HamburgerMenuIcon />}
          </Button>
        </div>
      </div>
      <div className={cn("grid overflow-hidden transition-[grid-template-rows] duration-300 ease-apple lg:hidden", open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
        <nav className="container min-h-0" aria-label="Mobile">
          <ul className="flex flex-col pb-3">
            {NAV.map((n) => (
              <li key={n.href}>
                <Link href={n.href} className="block rounded-md px-1 py-3 text-[17px] text-foreground" tabIndex={open ? 0 : -1}>
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = mounted && resolvedTheme === "dark";
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(dark ? "light" : "dark")}
      aria-label={dark ? "Switch to light appearance" : "Switch to dark appearance"}
      className="text-muted-foreground hover:text-foreground"
    >
      {/* Both icons stay mounted and cross-fade, so nothing jumps. */}
      <span className="relative size-4">
        <SunIcon className={cn("absolute inset-0 transition-opacity duration-300", dark ? "opacity-100" : "opacity-0")} />
        <MoonIcon className={cn("absolute inset-0 transition-opacity duration-300", dark ? "opacity-0" : "opacity-100")} />
      </span>
    </Button>
  );
}
