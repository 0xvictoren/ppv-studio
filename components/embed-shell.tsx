"use client";

import { useEffect, type ReactNode } from "react";
import { ConnectButton } from "@/components/connect-button";
import { Logo } from "@/components/logo";
import { env } from "@/lib/env";

/** Minimal chrome for embeds. Reports its height to the host page so the iframe fits its content. */
export function EmbedShell({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (window.parent === window) return;
    let last = 0;
    const send = () => {
      const h = Math.ceil(document.documentElement.scrollHeight);
      if (h !== last) {
        last = h;
        window.parent.postMessage({ type: "ppw:height", height: h }, "*");
      }
    };
    const ro = new ResizeObserver(send);
    ro.observe(document.body);
    send();
    return () => ro.disconnect();
  }, []);

  return (
    <div className="bg-background">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <a href={env.appUrl} target="_blank" rel="noopener" aria-label="PayPerWatch (opens in a new tab)" className="opacity-90 transition-opacity hover:opacity-100">
          <Logo />
        </a>
        <ConnectButton compact />
      </div>
      <div className="px-4 pb-6">{children}</div>
    </div>
  );
}
