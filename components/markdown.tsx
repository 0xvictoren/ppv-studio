import Link from "next/link";
import type { ReactNode } from "react";
import { CopyCode } from "@/components/copy-code";

// Renders the small Markdown subset MANUAL.md uses: ## and ### headings, paragraphs, - and 1.
// lists, > notes, | tables |, ``` code blocks, and inline **bold**, `code` and [links](url).
// Our own trusted file only; it never sees user content.

export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** The ## headings, for a table of contents. */
export function headings(md: string): { id: string; title: string }[] {
  return [...md.matchAll(/^## (.+)$/gm)].map((m) => ({ id: slug(m[1]), title: m[1] }));
}

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    const k = out.length;
    if (m[1] !== undefined) out.push(<strong key={k} className="font-semibold text-foreground">{inline(m[1])}</strong>);
    else if (m[2] !== undefined) out.push(<code key={k} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground">{m[2]}</code>);
    else {
      const external = /^https?:/.test(m[4]);
      out.push(
        external ? (
          <a key={k} href={m[4]} target="_blank" rel="noopener noreferrer" className="text-secondary underline-offset-4 hover:underline">{m[3]}</a>
        ) : (
          <Link key={k} href={m[4]} className="text-secondary underline-offset-4 hover:underline">{m[3]}</Link>
        ),
      );
    }
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (row: string) => row.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

export function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const k = blocks.length;
    if (!line.trim() || line.startsWith("# ")) {
      i++;
    } else if (line.startsWith("```")) {
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i].startsWith("```"); i++) code.push(lines[i]);
      i++;
      blocks.push(<CopyCode key={k} code={code.join("\n")} className="my-5" />);
    } else if (line.startsWith("## ")) {
      const t = line.slice(3);
      blocks.push(
        <h2 key={k} id={slug(t)} className="mt-16 scroll-mt-24 border-t pt-10 font-display text-[26px] font-semibold first:mt-0 first:border-t-0 first:pt-0">
          {t}
        </h2>,
      );
      i++;
    } else if (line.startsWith("### ")) {
      const t = line.slice(4);
      blocks.push(<h3 key={k} id={slug(t)} className="mt-10 scroll-mt-24 text-[19px] font-semibold">{t}</h3>);
      i++;
    } else if (line.startsWith("> ")) {
      const note: string[] = [];
      for (; i < lines.length && lines[i].startsWith("> "); i++) note.push(lines[i].slice(2));
      blocks.push(<p key={k} className="mt-5 rounded-lg border border-primary-border bg-tint p-5 text-[15px]">{inline(note.join(" "))}</p>);
    } else if (line.startsWith("|")) {
      const rows: string[][] = [];
      for (; i < lines.length && lines[i].startsWith("|"); i++) if (!/^\|[\s|:-]+\|$/.test(lines[i].trim())) rows.push(cells(lines[i]));
      const [head, ...body] = rows;
      blocks.push(
        <div key={k} className="mt-5 overflow-x-auto rounded-lg border">
          <table className="w-full text-[15px]">
            <thead className="bg-muted/60 text-left text-[13px] text-muted-foreground">
              <tr>{head.map((c, j) => <th key={j} scope="col" className="px-4 py-2.5 font-medium">{inline(c)}</th>)}</tr>
            </thead>
            <tbody>
              {body.map((r, n) => (
                <tr key={n} className="border-t align-top">
                  {r.map((c, j) => <td key={j} className="px-4 py-3 text-muted-foreground">{inline(c)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
    } else if (/^(- |\d+\. )/.test(line)) {
      const ordered = /^\d+\. /.test(line);
      const items: string[] = [];
      for (; i < lines.length && /^(- |\d+\. |\s{2,}\S)/.test(lines[i]); i++) {
        if (/^\s{2,}\S/.test(lines[i]) && items.length) items[items.length - 1] += "\n" + lines[i].trim();
        else items.push(lines[i].replace(/^(- |\d+\. )/, ""));
      }
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List key={k} className={`mt-4 space-y-2 pl-6 text-[15px] text-muted-foreground ${ordered ? "list-decimal" : "list-disc"}`}>
          {items.map((it, n) => {
            const [first, ...sub] = it.split("\n");
            return (
              <li key={n} className="pl-1">
                {inline(first)}
                {sub.length > 0 && (
                  <ul className="mt-2 list-[circle] space-y-1.5 pl-5">
                    {sub.map((s, j) => <li key={j}>{inline(s.replace(/^- /, ""))}</li>)}
                  </ul>
                )}
              </li>
            );
          })}
        </List>,
      );
    } else {
      const para: string[] = [];
      for (; i < lines.length && lines[i].trim() && !/^(#|```|>|\||- |\d+\. )/.test(lines[i]); i++) para.push(lines[i]);
      // A line that is all bold (an FAQ question) gets its own line above the answer.
      const [first, ...rest] = para;
      if (/^\*\*.+\*\*$/.test(first) && rest.length) {
        blocks.push(
          <div key={k} className="mt-6">
            <p className="text-[15px] font-semibold">{inline(first.slice(2, -2))}</p>
            <p className="mt-1 text-[15px] text-muted-foreground">{inline(rest.join(" "))}</p>
          </div>,
        );
      } else {
        blocks.push(<p key={k} className="mt-4 text-[15px] leading-relaxed text-muted-foreground">{inline(para.join(" "))}</p>);
      }
    }
  }
  return <>{blocks}</>;
}
