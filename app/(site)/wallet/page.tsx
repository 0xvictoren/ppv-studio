"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import { AddFundsDialog } from "@/components/add-funds-dialog";
import { EventsTable } from "@/components/events-table";
import { SettleNowButton } from "@/components/settle-now";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, EmptyState, Input, Label, PageTitle, Skeleton } from "@/components/ui/primitives";
import { useAppAccount } from "@/lib/client/account";
import { api } from "@/lib/client/api";
import { useEscrow, useEvents } from "@/lib/client/hooks";
import { mockFastForwardWithdrawal, readPpw } from "@/lib/client/ppw";
import { forgetSessionKey, listSessionKeys, type StoredSessionKey } from "@/lib/client/session-key";
import { useTx } from "@/lib/client/tx";
import { env, isMock, isTestnet } from "@/lib/env";
import { formatDuration, formatMinutes, formatUsdc, parseUsdc, shortAddress, toDecimal } from "@/lib/money";

type Session = { video_id: string; creator: string; title: string; seconds: number; amount: string };

export default function WalletPage() {
  const acct = useAppAccount();
  if (!acct.isConnected || !acct.address) {
    return (
      <div className="container max-w-md py-24">
        <EmptyState title="Connect your wallet" body="Your PayPerWatch balance, history and watch sessions live with your wallet.">
          <Button onClick={acct.connect}>Connect wallet</Button>
        </EmptyState>
      </div>
    );
  }
  return <Wallet address={acct.address} />;
}

function Wallet({ address }: { address: Address }) {
  const escrow = useEscrow(address);
  const events = useEvents({ viewer: address, name: "Deposited,Settled,Withdrawn,WithdrawRequested,WithdrawCancelled,SessionKeyAuthorized,SessionKeyRevoked" });
  const sessions = useQuery({
    queryKey: ["watch-sessions", "viewer", address],
    queryFn: () => api<{ sessions: Session[] }>(`/api/watch-sessions?viewer=${address}`).then((r) => r.sessions),
  });
  const [fundsOpen, setFundsOpen] = useState(false);

  const totalSpent = useMemo(
    () => (events.data ?? []).filter((e) => e.name === "Settled").reduce((a, e) => a + BigInt(String(e.args.delta)), 0n),
    [events.data],
  );
  const watchSeconds = (sessions.data ?? []).reduce((a, s) => a + s.seconds, 0);

  return (
    <div className="container space-y-8">
      <PageTitle title="Wallet" subtitle={address}>
        <div className="flex flex-wrap gap-2">
          <SettleNowButton />
          {isTestnet && (
            <Button variant="outline" asChild>
              <a href={env.faucetUrl} target="_blank" rel="noopener noreferrer">
                Get test USDC
              </a>
            </Button>
          )}
          <Button onClick={() => setFundsOpen(true)}>Add funds</Button>
        </div>
      </PageTitle>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Escrowed balance" value={escrow.data ? formatUsdc(escrow.data.balance) : null} hint={escrow.data && escrow.data.unsettled > 0n ? `${formatUsdc(escrow.data.unsettled)} watched, settling at the top of the hour` : "In the PayPerWatch contract"} />
        <Stat label="Available to watch" value={escrow.data ? formatUsdc(escrow.data.available) : null} hint={escrow.data ? `Wallet: ${formatUsdc(escrow.data.wallet)}` : undefined} />
        <Stat label="Total spent" value={events.data ? formatUsdc(totalSpent) : null} hint="Settled on-chain" />
        <Stat label="Total watch time" value={sessions.data ? formatMinutes(watchSeconds) : null} hint={`${sessions.data?.length ?? 0} sessions`} />
      </div>

      {escrow.data && escrow.data.balance === 0n && (
        <EmptyState title="No balance yet" body="Add a few dollars of USDC to start watching. You only pay for the seconds you watch.">
          <Button onClick={() => setFundsOpen(true)}>Add funds</Button>
        </EmptyState>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <WithdrawCard address={address} />
        <SessionKeysCard address={address} />
      </div>

      {env.legacyContracts.map((c) => (
        <LegacyBalanceCard key={c} address={address} contract={c} />
      ))}

      <ReferralCard address={address} />

      <Card>
        <CardHeader>
          <CardTitle>Spending by video</CardTitle>
        </CardHeader>
        <CardContent>
          {!sessions.data ? (
            <Skeleton className="h-20 w-full" />
          ) : sessions.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing watched yet.</p>
          ) : (
            <SpendTable sessions={sessions.data} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>History</CardTitle>
          <p className="text-sm text-muted-foreground">From contract events: deposits, hourly settlements and withdrawals.</p>
        </CardHeader>
        <CardContent>
          {events.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : events.error ? (
            <p className="text-sm text-destructive">{(events.error as Error).message}</p>
          ) : !events.data?.length ? (
            <p className="text-sm text-muted-foreground">No transactions yet.</p>
          ) : (
            <EventsTable events={events.data} perspective="viewer" />
          )}
        </CardContent>
      </Card>

      <AddFundsDialog open={fundsOpen} onOpenChange={setFundsOpen} title="Add funds" />
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string | null; hint?: string }) {
  return (
    <Card className="p-6">
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <p className="mt-1 h-9 font-display text-[26px] font-semibold tabular">{value ?? <Skeleton className="h-8 w-28" />}</p>
      <p className="mt-1 min-h-4 text-[13px] text-muted-foreground">{hint ?? " "}</p>
    </Card>
  );
}

function SpendTable({ sessions }: { sessions: Session[] }) {
  const rows = useMemo(() => {
    const m = new Map<string, { title: string; creator: string; seconds: number; amount: bigint }>();
    for (const s of sessions) {
      const r = m.get(s.video_id) ?? { title: s.title, creator: s.creator, seconds: 0, amount: 0n };
      r.seconds += s.seconds;
      r.amount += BigInt(s.amount);
      m.set(s.video_id, r);
    }
    return [...m.values()].sort((a, b) => (b.amount > a.amount ? 1 : -1));
  }, [sessions]);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="py-2 pr-4 font-medium">Video</th>
            <th scope="col" className="py-2 pr-4 font-medium">Creator</th>
            <th scope="col" className="py-2 pr-4 font-medium">Watched</th>
            <th scope="col" className="py-2 font-medium">Spent</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.title + r.creator} className="border-t">
              <td className="py-2 pr-4">{r.title}</td>
              <td className="py-2 pr-4 font-mono text-xs">{shortAddress(r.creator)}</td>
              <td className="py-2 pr-4 tabular">{formatDuration(r.seconds)}</td>
              <td className="py-2 tabular">{formatUsdc(r.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WithdrawCard({ address }: { address: Address }) {
  const escrow = useEscrow(address);
  const qc = useQueryClient();
  const tx = useTx();
  const [amount, setAmount] = useState("");
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(id);
  }, []);

  const pending = escrow.data?.pendingWithdrawal;
  const hasPending = !!pending && pending.amount > 0n;
  const ready = hasPending && now >= pending!.availableAt;
  const value = amount ? parseUsdc(amount) : null;
  const balance = escrow.data?.balance ?? 0n;
  const refresh = () => qc.invalidateQueries({ queryKey: ["escrow"] });

  const left = hasPending ? Math.max(0, pending!.availableAt - now) : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Withdraw unused funds</CardTitle>
        <p className="text-sm text-muted-foreground">
          Withdrawals are ready 1 hour after you request them. That gives the hourly settlement time to bill your final
          minutes, and you&apos;re never charged for anything you didn&apos;t watch.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {hasPending ? (
          <>
            <div className="rounded-md border bg-background p-4">
              <p className="text-sm">
                Requested: <strong className="tabular">{formatUsdc(pending!.amount)}</strong>
              </p>
              {ready ? (
                <p className="mt-1 text-sm text-secondary">Ready to withdraw.</p>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground" aria-live="polite">
                  Available in <span className="font-mono tabular text-foreground">{formatDuration(left)}</span>. We&apos;re settling your final watch time.
                </p>
              )}
              {pending!.amount > balance && (
                <p className="mt-1 text-xs text-muted-foreground">You&apos;ll receive {formatUsdc(balance)}, your balance after settlement.</p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button disabled={!ready || tx.busy} onClick={async () => (await tx.run(address, [{ label: "Withdraw", fn: "withdraw", args: [] }], "USDC sent to your wallet.")) && refresh()}>
                {tx.label("Withdraw")}
              </Button>
              <Button variant="outline" disabled={tx.busy} onClick={async () => (await tx.run(address, [{ label: "Cancel", fn: "cancelWithdraw", args: [] }], "Withdrawal cancelled.")) && refresh()}>
                Cancel
              </Button>
              {isMock && !ready && (
                <Button variant="ghost" size="sm" onClick={async () => { await mockFastForwardWithdrawal(address); await refresh(); }}>
                  Skip the hour (demo)
                </Button>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="space-y-1">
              <Label htmlFor="withdraw-amount">Amount (USDC)</Label>
              <div className="flex gap-2">
                <Input id="withdraw-amount" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
                <Button variant="outline" onClick={() => setAmount(toDecimal(escrow.data?.available ?? 0n, 2))}>
                  Max
                </Button>
              </div>
              {value !== null && value > balance && <p className="text-xs text-destructive">That&apos;s more than your balance of {formatUsdc(balance)}.</p>}
            </div>
            <Button
              disabled={!value || value <= 0n || value > balance || tx.busy}
              onClick={async () => {
                const ok = await tx.run(address, [{ label: "Request withdrawal", fn: "requestWithdraw", args: [value] }], "Withdrawal requested. It'll be ready in 1 hour.");
                if (ok) {
                  setAmount("");
                  refresh();
                }
              }}
            >
              {tx.label("Request withdrawal")}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function SessionKeysCard({ address }: { address: Address }) {
  const tx = useTx();
  const [keys, setKeys] = useState<StoredSessionKey[]>([]);
  useEffect(() => setKeys(listSessionKeys(address)), [address]);
  const status = useQuery({
    queryKey: ["session-keys", address, keys.map((k) => k.address).join()],
    enabled: keys.length > 0,
    queryFn: () =>
      Promise.all(
        keys.map(async (k) => {
          const [expiry, spendCap, spent] = await readPpw<readonly [bigint, bigint, bigint]>("sessionKeys", [address, k.address]);
          return { address: k.address, expiry: Number(expiry), spendCap, spent };
        }),
      ),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Session keys</CardTitle>
        <p className="text-sm text-muted-foreground">
          Temporary keys in this browser that sign your watch receipts. Each can spend only up to its limit and expires after 24 hours.
        </p>
      </CardHeader>
      <CardContent>
        {keys.length === 0 ? (
          <p className="text-sm text-muted-foreground">No session keys in this browser.</p>
        ) : (
          <ul className="space-y-2">
            {keys
              .slice()
              .reverse()
              .map((k) => {
                const s = status.data?.find((x) => x.address === k.address);
                const live = !!s && s.expiry > Date.now() / 1000;
                return (
                  <li key={k.address} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
                    <div>
                      <p className="font-mono text-xs">{shortAddress(k.address)}</p>
                      <p className="text-xs text-muted-foreground">
                        {!s
                          ? "Checking…"
                          : live
                            ? `Active until ${new Date(s.expiry * 1000).toLocaleString()} · used ${formatUsdc(s.spent)} of ${formatUsdc(s.spendCap)}`
                            : "Expired or revoked"}
                      </p>
                    </div>
                    {live ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={tx.busy}
                        onClick={async () => {
                          const ok = await tx.run(address, [{ label: "Revoke", fn: "revokeSessionKey", args: [k.address] }], "Session key revoked.");
                          if (ok) status.refetch();
                        }}
                      >
                        Revoke
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          forgetSessionKey(address, k.address);
                          setKeys(listSessionKeys(address));
                        }}
                      >
                        Remove
                      </Button>
                    )}
                  </li>
                );
              })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

type ReferralSummary = {
  earned: string;
  pending: string;
  referredViewers: number;
  videos: { id: string; title: string; viewers: number; seconds: number; earnedEstimate: string }[];
};

function ReferralCard({ address }: { address: Address }) {
  const q = useQuery({
    queryKey: ["referrals", address],
    refetchInterval: 60_000,
    queryFn: () => api<ReferralSummary>(`/api/referrals?referrer=${address}`),
  });
  const d = q.data;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Referral earnings</CardTitle>
        <p className="text-sm text-muted-foreground">
          Share a video you&apos;ve watched with your referral link and earn 5% of what the people you bring in spend on it, when the creator has turned on Share and earn. It&apos;s paid from the creator&apos;s share, straight to your wallet at each hourly settlement.
        </p>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-6 sm:grid-cols-3">
          <div>
            <dt className="text-[13px] text-muted-foreground">Earned</dt>
            <dd className="mt-1 h-8 font-display text-[22px] font-semibold tabular">{d ? formatUsdc(BigInt(d.earned)) : <Skeleton className="h-7 w-24" />}</dd>
          </div>
          <div>
            <dt className="text-[13px] text-muted-foreground">Pending</dt>
            <dd className="mt-1 h-8 font-display text-[22px] font-semibold tabular">{d ? formatUsdc(BigInt(d.pending)) : <Skeleton className="h-7 w-24" />}</dd>
          </div>
          <div>
            <dt className="text-[13px] text-muted-foreground">People you brought in</dt>
            <dd className="mt-1 h-8 font-display text-[22px] font-semibold tabular">{d ? d.referredViewers : <Skeleton className="h-7 w-12" />}</dd>
          </div>
        </dl>
        {d && d.videos.length > 0 ? (
          <div className="mt-6 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[13px] text-muted-foreground">
                <tr>
                  <th scope="col" className="py-3 pr-4 font-medium">Video</th>
                  <th scope="col" className="py-3 pr-4 font-medium">Viewers</th>
                  <th scope="col" className="py-3 pr-4 font-medium">Watched</th>
                  <th scope="col" className="py-3 font-medium">Your 5%</th>
                </tr>
              </thead>
              <tbody>
                {d.videos.map((v) => (
                  <tr key={v.id} className="border-t">
                    <td className="py-3 pr-4">{v.title}</td>
                    <td className="py-3 pr-4 tabular">{v.viewers}</td>
                    <td className="py-3 pr-4 tabular">{formatDuration(v.seconds)}</td>
                    <td className="py-3 tabular">{formatUsdc(BigInt(v.earnedEstimate))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          d && <p className="mt-6 text-sm text-muted-foreground">No one has watched through your links yet. Open a video you&apos;ve watched and choose Share and earn.</p>
        )}
      </CardContent>
    </Card>
  );
}

/** Balance left on an earlier PayPerWatch contract: request, wait an hour, withdraw. Hidden when empty. */
function LegacyBalanceCard({ address, contract }: { address: Address; contract: Address }) {
  const tx = useTx();
  const q = useQuery({
    queryKey: ["legacy", contract, address],
    refetchInterval: 30_000,
    queryFn: async () => {
      const [balance, pw] = await Promise.all([
        readPpw<bigint>("balanceOf", [address], contract),
        readPpw<readonly [bigint, bigint]>("pendingWithdrawal", [address], contract),
      ]);
      return { balance, pending: pw[0], availableAt: Number(pw[1]) };
    },
  });
  if (!q.data || q.data.balance === 0n) return null;
  const { balance, pending, availableAt } = q.data;
  const ready = pending > 0n && Date.now() / 1000 >= availableAt;
  return (
    <Card className="border-primary-border bg-tint">
      <CardHeader>
        <CardTitle>Balance on an earlier contract</CardTitle>
        <p className="text-sm text-muted-foreground">
          PayPerWatch moved to a new contract. You still have {formatUsdc(balance)} on the old one (<span className="font-mono">{shortAddress(contract)}</span>). Withdraw it to your wallet, then add funds again here.
        </p>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3">
        {pending === 0n ? (
          <Button disabled={tx.busy} onClick={async () => (await tx.run(address, [{ label: "Request withdrawal", fn: "requestWithdraw", args: [balance], contract }], "Requested. It'll be ready in 1 hour.")) && q.refetch()}>
            {tx.label(`Request ${formatUsdc(balance)}`)}
          </Button>
        ) : ready ? (
          <Button disabled={tx.busy} onClick={async () => (await tx.run(address, [{ label: "Withdraw", fn: "withdraw", args: [], contract }], "USDC sent to your wallet.")) && q.refetch()}>
            {tx.label("Withdraw")}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">Ready {new Date(availableAt * 1000).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}.</p>
        )}
      </CardContent>
    </Card>
  );
}
