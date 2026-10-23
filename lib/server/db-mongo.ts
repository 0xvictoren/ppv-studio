import "server-only";
import { Decimal128, MongoServerError } from "mongodb";
import type { ProgressRow, ReceiptRow, SettlementRunRow, VideoRow, WatchSessionRow } from "./db";
import { clean, col } from "./mongo";

// MongoDB implementations of the metadata store. Same semantics as the Supabase and file backends.
// Rows keep the exact field names of the other backends; Mongo's _id is a natural key.

type WithId<T> = T & { _id: string };
const lc = (s: string) => s.toLowerCase();
const rkey = (r: Pick<ReceiptRow, "viewer" | "creator" | "referrer">) => `${lc(r.viewer)}:${lc(r.creator)}:${lc(r.referrer)}`;
const many = <T>(docs: unknown[]) => docs.map((d) => clean<T>(d as never)!) as T[];

// ---------------------------------------------------------------- videos

export async function listVideos(filter: { creator?: string; category?: string }): Promise<VideoRow[]> {
  const q: Record<string, unknown> = {};
  if (filter.creator) q.creator = lc(filter.creator);
  if (filter.category) q.category = filter.category;
  return many<VideoRow>(await (await col<WithId<VideoRow>>("videos")).find(q).sort({ created_at: -1 }).toArray());
}

export async function getVideo(id: string): Promise<VideoRow | null> {
  return clean<VideoRow>(await (await col<WithId<VideoRow>>("videos")).findOne({ _id: lc(id) }));
}

export async function putVideo(row: VideoRow): Promise<void> {
  await (await col<WithId<VideoRow>>("videos")).replaceOne({ _id: row.id }, { ...row }, { upsert: true });
}

export async function patchVideo(id: string, patch: Partial<VideoRow>): Promise<void> {
  await (await col<WithId<VideoRow>>("videos")).updateOne({ _id: lc(id) }, { $set: patch });
}

export async function deleteVideo(id: string): Promise<void> {
  await (await col("videos")).deleteOne({ _id: lc(id) } as never);
}

export async function countVideos(): Promise<number> {
  return (await col("videos")).estimatedDocumentCount();
}

// ---------------------------------------------------------------- receipts

export async function getReceipt(viewer: string, creator: string, referrer: string): Promise<ReceiptRow | null> {
  return clean<ReceiptRow>(await (await col<WithId<ReceiptRow>>("receipts")).findOne({ _id: rkey({ viewer, creator, referrer }) }));
}

export async function listReceipts(filter: { viewer?: string; creator?: string; referrer?: string }): Promise<ReceiptRow[]> {
  const q: Record<string, unknown> = {};
  if (filter.viewer) q.viewer = lc(filter.viewer);
  if (filter.creator) q.creator = lc(filter.creator);
  if (filter.referrer) q.referrer = lc(filter.referrer);
  return many<ReceiptRow>(await (await col<WithId<ReceiptRow>>("receipts")).find(q).toArray());
}

/**
 * Atomic monotonic upsert: matches only if the stored amount is <= the new one. If a higher
 * receipt is stored, the upsert tries to insert a duplicate _id and fails -> returns false.
 */
export async function putReceipt(row: ReceiptRow): Promise<boolean> {
  const _id = rkey(row);
  const cum = Decimal128.fromString(row.cumulative_amount);
  try {
    await (await col<WithId<ReceiptRow> & { cum_sort: Decimal128 }>("receipts")).updateOne(
      { _id, cum_sort: { $lte: cum } },
      { $set: { ...row, cum_sort: cum } },
      { upsert: true },
    );
    return true;
  } catch (e) {
    if (e instanceof MongoServerError && e.code === 11000) return false;
    throw e;
  }
}

export async function setSettled(viewer: string, creator: string, referrer: string, settled: string): Promise<void> {
  await (await col("receipts")).updateOne({ _id: rkey({ viewer, creator, referrer }) } as never, { $set: { settled_amount: settled } });
}

// ---------------------------------------------------------------- watch sessions

export async function getSession(id: string): Promise<WatchSessionRow | null> {
  return clean<WatchSessionRow>(await (await col<WithId<WatchSessionRow>>("watch_sessions")).findOne({ _id: id }));
}

export async function putSession(row: WatchSessionRow): Promise<void> {
  await (await col<WithId<WatchSessionRow>>("watch_sessions")).replaceOne({ _id: row.id }, { ...row }, { upsert: true });
}

export async function listSessions(filter: { viewer?: string; creator?: string; videoId?: string }): Promise<WatchSessionRow[]> {
  const q: Record<string, unknown> = {};
  if (filter.viewer) q.viewer = lc(filter.viewer);
  if (filter.creator) q.creator = lc(filter.creator);
  if (filter.videoId) q.video_id = lc(filter.videoId);
  return many<WatchSessionRow>(await (await col<WithId<WatchSessionRow>>("watch_sessions")).find(q).toArray());
}

// ---------------------------------------------------------------- watch progress

export async function getProgress(viewer: string, videoId: string): Promise<ProgressRow | null> {
  return clean<ProgressRow>(await (await col<WithId<ProgressRow>>("watch_progress")).findOne({ _id: `${lc(viewer)}:${lc(videoId)}` }));
}

export async function putProgress(row: ProgressRow): Promise<void> {
  const _id = `${row.viewer}:${row.video_id}`;
  await (await col<WithId<ProgressRow>>("watch_progress")).replaceOne({ _id }, { ...row }, { upsert: true });
}

// ---------------------------------------------------------------- settlement runs

export async function addRun(run: Omit<SettlementRunRow, "id">): Promise<void> {
  const c = await col<SettlementRunRow & { _id?: unknown }>("settlement_runs");
  await c.insertOne({ id: Date.now(), ...run });
}

export async function lastRun(): Promise<SettlementRunRow | null> {
  const c = await col<SettlementRunRow & { _id?: unknown }>("settlement_runs");
  return clean<SettlementRunRow>(await c.find({ status: { $ne: "error" } }).sort({ started_at: -1 }).limit(1).next());
}
