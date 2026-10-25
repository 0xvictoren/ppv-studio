import { readFileSync } from "node:fs";
import path from "node:path";
import { Markdown } from "@/components/markdown";
import { PageTitle } from "@/components/ui/primitives";

// Terms and privacy are kept as Markdown in ./legal, so they can be edited (and reviewed) as plain text.
// The operator and contact come from env so each deployment names who runs it.
const OPERATOR = process.env.NEXT_PUBLIC_OPERATOR_NAME || "the PayPerWatch team";
const CONTACT = process.env.NEXT_PUBLIC_CONTACT_EMAIL || "ekumanzubechi97@gmail.com";
const UPDATED = process.env.NEXT_PUBLIC_LEGAL_UPDATED || "October 24, 2026";

export function LegalPage({ file, title }: { file: string; title: string }) {
  const source = readFileSync(path.join(process.cwd(), "legal", file), "utf8")
    .replaceAll("{{operator}}", OPERATOR)
    .replaceAll("{{contact}}", CONTACT.includes("@") ? `[${CONTACT}](mailto:${CONTACT})` : CONTACT)
    .replaceAll("{{updated}}", UPDATED);
  return (
    <div className="container max-w-3xl">
      <PageTitle title={title} />
      <article>
        <Markdown source={source} />
      </article>
    </div>
  );
}
