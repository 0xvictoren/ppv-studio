import "server-only";
import { waitUntil } from "@vercel/functions";
import { getAddress, type Hex } from "viem";
import { ZERO_ADDRESS, type Receipt } from "../contract";
import { readPpw, submitSettleBatch } from "./chain";
import { insertSettlementRun, listReceipts, setSettledAmount } from "./db";

const BATCH_SIZE = 50;

export type SettleResult = { status: "success" | "noop" | "error"; count: number; total: string; txHashes: Hex[]; error?: string };

type Triple = { viewer: string; creator: string; referrer: string };
const tkey = (t: Triple) => `${t.viewer}:${t.creator}:${t.referrer}`.toLowerCase();

// One settlement at a time, so the hourly run and milestone settlements never race.
const g = globalThis as unknown as { __ppwSettleLock?: Promise<unknown>; __ppwMilestones?: { due: Map<string, Triple>; timer?: ReturnType<typeof setTimeout> } };
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = (g.__ppwSettleLock ?? Promise.resolve()).then(fn, fn);
  g.__ppwSettleLock = run.catch(() => {});
  return run;
}

/**
 * Settle stored receipts whose cumulativeAmount is above what's settled onchain: all of them
 * (hourly cron), or only the given (viewer, creator, referrer) lanes (milestones, downloads).
 */
export function runSettlement(opts: { only?: Triple[] } = {}): Promise<SettleResult> {
  return exclusive(() => settleNow(opts));
}

/** Queue a lane for settlement at a watch milestone (10/25/50/75/100%). Batched over a few seconds. */
export function requestMilestoneSettlement(t: Triple) {
  // Serverless (Vercel): timers may not survive the response, so settle now and keep the
  // function alive until it's done.
  if (process.env.VERCEL) {
    waitUntil(runSettlement({ only: [t] }).then((r) => console.log(`[settle] milestone settlement: ${r.status} ${r.count} receipt(s)`)));
    return;
  }
  type Queue = { due: Map<string, Triple>; timer?: ReturnType<typeof setTimeout> };
  const q: Queue = (g.__ppwMilestones ??= { due: new Map() } as Queue);
  q.due.set(tkey(t), t);
  if (q.timer) return;
  q.timer = setTimeout(() => {
    const only = [...q.due.values()];
    q.due.clear();
    q.timer = undefined;
    runSettlement({ only }).then((r) => console.log(`[settle] milestone settlement: ${r.status} ${r.count} receipt(s)`));
  }, 5_000);
}

async function settleNow(opts: { only?: Triple[] }): Promise<SettleResult> {
  const startedAt = new Date().toISOString();
  const now = BigInt(Math.floor(Date.now() / 1000));
  const txHashes: Hex[] = [];
  let count = 0;
  let skippedCount = 0;
  let total = 0n;

  try {
    const wanted = opts.only ? new Set(opts.only.map(tkey)) : null;
    const rows = (await listReceipts()).filter((r) => !wanted || wanted.has(tkey(r)));
    const due: { r: Receipt; sig: Hex; delta: bigint }[] = [];
    for (const row of rows) {
      const settled = await readPpw<bigint>("settled", [row.viewer, row.creator, row.referrer]);
      if (settled.toString() !== row.settled_amount) await setSettledAmount(row.viewer, row.creator, row.referrer, settled);
      const cumulative = BigInt(row.cumulative_amount);
      if (cumulative <= settled || BigInt(row.deadline) <= now) continue;
      due.push({
        r: {
          viewer: getAddress(row.viewer),
          creator: getAddress(row.creator),
          referrer: getAddress(row.referrer),
          cumulativeAmount: cumulative,
          deadline: BigInt(row.deadline),
        },
        sig: row.signature as Hex,
        delta: cumulative - settled,
      });
    }

    // Unreferred receipts first: a referrer only earns once their own payment to the creator has settled.
    due.sort((a, b) => Number(a.r.referrer !== ZERO_ADDRESS) - Number(b.r.referrer !== ZERO_ADDRESS));

    // A batch that can't go through at all (one receipt's smart-contract wallet burning all the gas
    // reverts the whole tx) must not hold up everyone else's payout: retry its receipts one by one.
    const chunks: (typeof due)[] = [];
    for (let i = 0; i < due.length; i += BATCH_SIZE) chunks.push(due.slice(i, i + BATCH_SIZE));
    while (chunks.length) {
      const chunk = chunks.shift()!;
      let result: Awaited<ReturnType<typeof submitSettleBatch>>;
      try {
        result = await submitSettleBatch(chunk.map((d) => d.r), chunk.map((d) => d.sig));
      } catch (e) {
        if (chunk.length > 1) {
          console.error(`[settle] settleBatch(${chunk.length}) failed, retrying one by one:`, e instanceof Error ? e.message.split("\n")[0] : e);
          chunks.unshift(...chunk.map((d) => [d]));
        } else {
          const d = chunk[0];
          console.error(`[settle] couldn't settle ${d.r.viewer} -> ${d.r.creator} (${d.delta} units):`, e instanceof Error ? e.message.split("\n")[0] : e);
          skippedCount++;
        }
        continue;
      }
      const { hash, skipped } = result;
      console.log(`[settle] settleBatch(${chunk.length}) tx ${hash}${skipped.length ? `, ${skipped.length} skipped` : ""}`);
      txHashes.push(hash);
      for (const s of skipped) {
        const d = chunk[s.index];
        console.error(`[settle] skipped ${d.r.viewer} -> ${d.r.creator} (${d.delta} units), reason ${s.reason}`);
        skippedCount++;
      }
      const skippedIdx = new Set(skipped.map((s) => s.index));
      for (const [j, d] of chunk.entries()) {
        const settled = await readPpw<bigint>("settled", [d.r.viewer, d.r.creator, d.r.referrer]);
        await setSettledAmount(d.r.viewer, d.r.creator, d.r.referrer, settled);
        if (skippedIdx.has(j)) continue;
        count++;
        total += d.delta;
      }
    }

    const status = skippedCount ? "error" : count === 0 ? "noop" : "success";
    await insertSettlementRun({
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      status,
      receipts_count: count,
      total_amount: total.toString(),
      tx_hash: txHashes.join(",") || null,
      error: skippedCount ? `${skippedCount} receipt(s) skipped by the contract; see server logs` : null,
    });
    return { status, count, total: total.toString(), txHashes, ...(skippedCount && { error: `${skippedCount} receipt(s) skipped` }) };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[settle] failed:", message);
    await insertSettlementRun({
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      status: "error",
      receipts_count: count,
      total_amount: total.toString(),
      tx_hash: txHashes.join(",") || null,
      error: message.slice(0, 1000),
    }).catch(() => {});
    return { status: "error", count, total: total.toString(), txHashes, error: message };
  }
}

/** Settlement runs at the top of every hour (vercel.json: "0 * * * *"). */
export function nextRunAt(from = new Date()): Date {
  const d = new Date(from);
  d.setUTCMinutes(0, 0, 0);
  d.setUTCHours(d.getUTCHours() + 1);
  return d;
}
