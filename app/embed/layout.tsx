import type { Metadata } from "next";
import { EmbedShell } from "@/components/embed-shell";

export const metadata: Metadata = { title: "PayPerWatch", robots: { index: false } };

export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  return <EmbedShell>{children}</EmbedShell>;
}
