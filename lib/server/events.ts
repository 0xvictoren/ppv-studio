import "server-only";
import { decodeEventLog, type Log } from "viem";
import { ppwAbi, PPW_ADDRESS, type PpwEvent } from "../contract";
import { env, isMock } from "../env";
import * as mock from "../mock/contract";
import { publicClient } from "./chain";

// Contract events, normalized to JSON. In real mode we scan logs from the deploy block in
// chunks (public RPCs cap the range) and cache the result for a short time.

const CHUNK = 10_000n;
const TTL_MS = 15_000;

const g = globalThis as unknown as { __ppwEvents?: { at: number; toBlock: bigint; events: PpwEvent[] } };

async function scan(): Promise<PpwEvent[]> {
  const cached = g.__ppwEvents;
  if (cached && Date.now() - cached.at < TTL_MS) return cached.events;

  const latest = await publicClient.getBlockNumber();
  const events = cached?.events.slice() ?? [];
  let from = cached ? cached.toBlock + 1n : env.deployBlock;
  const blockTimes = new Map<bigint, number>();

  while (from <= latest) {
    const to = from + CHUNK - 1n > latest ? latest : from + CHUNK - 1n;
    const logs = await publicClient.getLogs({ address: PPW_ADDRESS, fromBlock: from, toBlock: to });
    for (const log of logs) {
      const ev = await normalize(log, blockTimes);
      if (ev) events.push(ev);
    }
    from = to + 1n;
  }
  g.__ppwEvents = { at: Date.now(), toBlock: latest, events };
  return events;
}

async function normalize(log: Log, blockTimes: Map<bigint, number>): Promise<PpwEvent | null> {
  try {
    const decoded = decodeEventLog({ abi: ppwAbi, data: log.data, topics: log.topics });
    const bn = log.blockNumber!;
    if (!blockTimes.has(bn)) {
      const block = await publicClient.getBlock({ blockNumber: bn });
      blockTimes.set(bn, Number(block.timestamp));
    }
    const args: Record<string, string | boolean> = {};
    for (const [k, v] of Object.entries(decoded.args ?? {})) args[k] = typeof v === "boolean" ? v : String(v);
    return { name: decoded.eventName, args, txHash: log.transactionHash!, blockNumber: bn.toString(), timestamp: blockTimes.get(bn)! };
  } catch {
    return null; // event not in our ABI
  }
}

export async function getEvents(filter: { name?: string[]; viewer?: string; creator?: string; videoId?: string } = {}) {
  const all = isMock ? mock.events() : await scan();
  const eq = (a?: string | boolean, b?: string) => typeof a === "string" && !!b && a.toLowerCase() === b.toLowerCase();
  return all.filter(
    (e) =>
      (!filter.name || filter.name.includes(e.name)) &&
      (!filter.viewer || eq(e.args.viewer, filter.viewer)) &&
      (!filter.creator || eq(e.args.creator, filter.creator)) &&
      (!filter.videoId || eq(e.args.videoId, filter.videoId)),
  );
}
