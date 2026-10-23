import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = { title: "Privacy policy" };
export const dynamic = "force-static";

export default function PrivacyPage() {
  return <LegalPage file="privacy.md" title="Privacy policy" />;
}
