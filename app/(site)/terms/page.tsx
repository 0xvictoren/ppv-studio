import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = { title: "Terms of service" };
export const dynamic = "force-static";

export default function TermsPage() {
  return <LegalPage file="terms.md" title="Terms of service" />;
}
