"use client";

import { cn } from "@/lib/utils";

/** Apple-style segmented control. Keyboard: arrow keys move the selection. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: readonly { id: T; label: string }[];
  label: string;
  className?: string;
}) {
  const idx = options.findIndex((o) => o.id === value);
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("inline-flex rounded-md bg-muted p-[3px]", className)}
      onKeyDown={(e) => {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        e.preventDefault();
        const next = options[(idx + (e.key === "ArrowRight" ? 1 : options.length - 1)) % options.length];
        onChange(next.id);
        (e.currentTarget.querySelector(`[data-id="${next.id}"]`) as HTMLElement | null)?.focus();
      }}
    >
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            data-id={o.id}
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.id)}
            className={cn(
              "rounded-[7px] px-3.5 py-1.5 text-sm transition-[background-color,color,box-shadow] duration-200 ease-apple",
              on ? "bg-background font-medium text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.06)]" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
