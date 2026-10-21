"use client";

import { CheckIcon, CopyIcon } from "@radix-ui/react-icons";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useAppAccount } from "@/lib/client/account";
import { api } from "@/lib/client/api";
import { friendlyError } from "@/lib/client/errors";
import { env } from "@/lib/env";
import { cn } from "@/lib/utils";

/**
 * Share a video. Anyone can copy the plain link; a signed-in viewer who has watched the video
 * gets a referral link that earns them 5% of what people they bring in spend on it.
 */
export function ShareDialog({
  open,
  onOpenChange,
  videoId,
  isCreator,
  referralsEnabled,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  videoId: string;
  isCreator: boolean;
  referralsEnabled: boolean;
}) {
  const acct = useAppAccount();
  const [link, setLink] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const plain = `${env.appUrl}/watch/${videoId}`;

  useEffect(() => {
    setLink(null);
    setProblem(null);
  }, [acct.address, videoId]);

  async function getLink() {
    setLoading(true);
    setProblem(null);
    try {
      if (!acct.signedInAs) {
        const ok = await acct.signIn();
        if (!ok) return;
      }
      const r = await api<{ url: string }>("/api/referrals/link", { method: "POST", json: { videoId } });
      setLink(r.url);
    } catch (e) {
      setProblem(friendlyError(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Share this video">
      <CopyRow label="Link" value={plain} />

      {!referralsEnabled && !isCreator && (
        <p className="mt-4 text-[13px] text-muted-foreground">The creator keeps all earnings from this video, so there&apos;s no referral reward for sharing it.</p>
      )}
      {referralsEnabled && !isCreator && (
        <div className="mt-6 border-t pt-6">
          <p className="text-[15px] font-medium">Earn 5% when people watch through your link</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            You get 5% of what everyone you bring in spends on this video, paid from the creator&apos;s share at each hourly
            settlement. Their price doesn&apos;t change.
          </p>
          {link ? (
            <CopyRow className="mt-4" label="Your referral link" value={link} />
          ) : (
            <div className="mt-4">
              {acct.isConnected ? (
                <Button onClick={getLink} disabled={loading || acct.signingIn} className="w-full">
                  {loading || acct.signingIn ? "Check your wallet…" : acct.signedInAs ? "Get my referral link" : "Sign in to get my referral link"}
                </Button>
              ) : (
                <Button onClick={acct.connect} className="w-full">
                  Connect wallet to earn
                </Button>
              )}
              <p className={cn("mt-2 min-h-5 text-[13px]", problem ? "text-destructive" : "text-muted-foreground")}>
                {problem ?? "Signing in is free. Links unlock once you've watched the video yourself."}
              </p>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

function CopyRow({ label, value, className }: { label: string; value: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={className}>
      <p className="mb-1.5 text-[13px] text-muted-foreground">{label}</p>
      <div className="flex gap-2">
        <input readOnly value={value} onFocus={(e) => e.currentTarget.select()} className="h-11 min-w-0 flex-1 rounded-md border bg-background px-3 font-mono text-[13px]" aria-label={label} />
        <Button
          variant="outline"
          size="icon"
          className="h-11 w-11 shrink-0"
          aria-label={copied ? "Copied" : `Copy ${label.toLowerCase()}`}
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            toast.success("Copied");
            setTimeout(() => setCopied(false), 1600);
          }}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </Button>
      </div>
    </div>
  );
}
