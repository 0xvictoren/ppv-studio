"use client";

import { useEffect, useRef, useState, type ElementType, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Fades content in once as it enters the viewport (transform + opacity only). */
export function Reveal({ children, index = 0, as: Tag = "div", className }: { children: ReactNode; index?: number; as?: ElementType; className?: string }) {
  const ref = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <Tag ref={ref} data-shown={shown} style={{ "--i": index } as React.CSSProperties} className={cn("reveal", className)}>
      {children}
    </Tag>
  );
}
