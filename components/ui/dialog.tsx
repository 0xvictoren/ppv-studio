"use client";

import * as D from "@radix-ui/react-dialog";
import { Cross2Icon } from "@radix-ui/react-icons";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
  dismissible = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  dismissible?: boolean;
}) {
  return (
    <D.Root open={open} onOpenChange={(o) => (dismissible || o) && onOpenChange(o)}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-overlay/50 backdrop-blur-[2px] data-[state=closed]:animate-[fadeOut_160ms_ease] data-[state=open]:animate-[fadeIn_200ms_ease]" />
        <D.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-surface p-7 shadow-[0_24px_64px_rgba(0,0,0,0.14)] data-[state=open]:animate-[dialogIn_240ms_cubic-bezier(0.16,1,0.3,1)]",
            className,
          )}
          onEscapeKeyDown={(e) => !dismissible && e.preventDefault()}
          onPointerDownOutside={(e) => !dismissible && e.preventDefault()}
        >
          <D.Title className="pr-8 font-display text-[22px] font-semibold">{title}</D.Title>
          {description ? (
            <D.Description className="mt-2 text-[15px] text-muted-foreground">{description}</D.Description>
          ) : (
            <D.Description className="sr-only">{title}</D.Description>
          )}
          <div className="mt-5">{children}</div>
          {dismissible && (
            <D.Close
              className="absolute right-5 top-5 grid size-8 place-items-center rounded-full text-muted-foreground transition-colors duration-200 hover:bg-muted hover:text-foreground"
              aria-label="Close"
            >
              <Cross2Icon />
            </D.Close>
          )}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
