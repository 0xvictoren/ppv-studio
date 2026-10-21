import { ExternalLinkIcon } from "@radix-ui/react-icons";
import type { PpwEvent } from "@/lib/contract";
import { explorerTx } from "@/lib/env";
import { formatUsdc, shortAddress } from "@/lib/money";

const LABELS: Record<string, string> = {
  Deposited: "Deposit",
  Settled: "Settled",
  Withdrawn: "Withdrawal",
  WithdrawRequested: "Withdrawal requested",
  WithdrawCancelled: "Withdrawal cancelled",
  SessionKeyAuthorized: "Watch session started",
  SessionKeyRevoked: "Session key revoked",
  PartialSettlement: "Partial settlement",
};

type Perspective = "viewer" | "creator" | "referrer";

function amountOf(e: PpwEvent, perspective: Perspective): string {
  const a = e.args;
  switch (e.name) {
    case "Deposited":
      return `+${formatUsdc(BigInt(String(a.amount)))}`;
    case "Withdrawn":
    case "WithdrawRequested":
      return formatUsdc(BigInt(String(a.amount)));
    case "Settled": {
      const delta = BigInt(String(a.delta));
      if (perspective === "viewer") return `−${formatUsdc(delta)}`;
      if (perspective === "referrer") return `+${formatUsdc(BigInt(String(a.referralAmount ?? "0")))}`;
      return `+${formatUsdc(delta - BigInt(String(a.fee)) - BigInt(String(a.referralAmount ?? "0")))}`;
    }
    case "SessionKeyAuthorized":
      return `limit ${formatUsdc(BigInt(String(a.spendCap)))}`;
    default:
      return "";
  }
}

export function EventsTable({ events, perspective }: { events: PpwEvent[]; perspective: Perspective }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">Transaction history</caption>
        <thead className="text-left text-[13px] text-muted-foreground">
          <tr>
            <th scope="col" className="py-3 pr-4 font-medium">Event</th>
            <th scope="col" className="py-3 pr-4 font-medium">Amount</th>
            <th scope="col" className="py-3 pr-4 font-medium">{perspective === "viewer" ? "Creator" : "Viewer"}</th>
            <th scope="col" className="py-3 pr-4 font-medium">When</th>
            <th scope="col" className="py-3 font-medium">Tx</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e, i) => {
            const link = explorerTx(e.txHash);
            const counterparty = perspective === "viewer" ? e.args.creator : e.args.viewer;
            return (
              <tr key={`${e.txHash}-${i}`} className="border-t">
                <td className="py-3 pr-4">{LABELS[e.name] ?? e.name}</td>
                <td className="py-3 pr-4 tabular">{amountOf(e, perspective)}</td>
                <td className="py-3 pr-4 font-mono text-xs">{typeof counterparty === "string" ? shortAddress(counterparty) : "—"}</td>
                <td className="py-3 pr-4 text-muted-foreground">{new Date(e.timestamp * 1000).toLocaleString()}</td>
                <td className="py-2">
                  {link ? (
                    <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-secondary hover:underline">
                      {e.txHash.slice(0, 8)}… <ExternalLinkIcon className="size-3" aria-hidden />
                      <span className="sr-only">(opens explorer)</span>
                    </a>
                  ) : (
                    <span className="font-mono text-xs text-muted-foreground">{e.txHash.slice(0, 8)}… (mock)</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
