"use client";

import { CheckIcon, CopyIcon } from "@radix-ui/react-icons";
import { useState } from "react";
import { cn } from "@/lib/utils";

export function CopyCode({ code, label, className }: { code: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={cn("group relative", className)}>
      {label && <p className="mb-2 text-[13px] text-muted-foreground">{label}</p>}
      <pre className="overflow-x-auto rounded-md border bg-background p-4 pr-14 font-mono text-[13px] leading-relaxed">
        <code>{code}</code>
      </pre>
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        }}
        aria-label={copied ? "Copied" : "Copy code"}
        className={cn(
          "absolute right-2 grid size-8 place-items-center rounded-md text-muted-foreground transition-colors duration-200 hover:bg-muted hover:text-foreground",
          label ? "top-9" : "top-2",
        )}
      >
        <span className="relative size-4">
          <CopyIcon className={cn("absolute inset-0 transition-opacity duration-200", copied ? "opacity-0" : "opacity-100")} />
          <CheckIcon className={cn("absolute inset-0 transition-opacity duration-200", copied ? "opacity-100" : "opacity-0")} />
        </span>
      </button>
    </div>
  );
}
