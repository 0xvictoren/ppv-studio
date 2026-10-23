import "server-only";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isMock } from "../env";
import { DATA_DIR } from "./db";
import { clean, col, mongoEnabled } from "./mongo";

// Originality reviews, the fingerprint/transcript index the review worker builds, and the
// ledger of agent purchases. MongoDB when MONGODB_URI is set, otherwise
// $PPW_DATA_DIR/ppw-content.json (memory only in mock mode).

export type ReviewStatus = "queued" | "passed" | "held" | "explained" | "blocked" | "failed";

export type ReviewMatch = {
  content_cid: string;
  video_id: string | null;
  title: string;
  creator: string;
  /** "copy": same frames or audio. "topic": transcript covers the same ground. */
  kind: "copy" | "topic";
  /** 0..1 */
  similarity: number;
};

export type ReviewRow = {
  /** The upload's content id; one review per upload. */
  id: string;
  creator: string;
  playback_url: string;
  title: string;
  description: string;
  duration_seconds: number;
  status: ReviewStatus;
  /** Originality 0..100, null until checked. */
  score: number | null;
  matches: ReviewMatch[];
  /** For held videos: the creator's note on what this video adds. */
  note: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export type TranscriptSegment = { start: number; end: number; text: string };

export type MediaIndexRow = {
  /** content_cid */
  id: string;
  creator: string;
  /** Set once the video is registered and published. Only published entries are compared against. */
  video_id: string | null;
  title: string;
  /** 64-bit frame hashes (1 per second), 16 hex chars each, concatenated. */
  frames: string;
  /** Chromaprint raw fingerprint, base64 of little-endian uint32s. */
  audio: string;
  transcript: string;
  segments: TranscriptSegment[];
  /** Version of the worker's transcription that made `segments` (missing on old entries = 1). */
  transcriber?: number;
  created_at: string;
};

export type AgentPurchaseRow = {
  id: string;
  video_id: string;
  creator: string;
  payer: string;
  /** USDC base units */
  amount: string;
  network: string;
  transaction: string | null;
  created_at: string;
};

const lc = (s: string) => s.toLowerCase();
const nowIso = () => new Date().toISOString();

// ------------------------------------------------------------------ file backend

type Local = { reviews: Map<string, ReviewRow>; index: Map<string, MediaIndexRow>; purchases: AgentPurchaseRow[] };
const g = globalThis as unknown as { __ppwContent?: Local };
const FILE = path.join(DATA_DIR, "ppw-content.json");

function local(): Local {
  if (!g.__ppwContent) {
    const m: Local = { reviews: new Map(), index: new Map(), purchases: [] };
    if (!isMock && existsSync(FILE)) {
      const raw = JSON.parse(readFileSync(FILE, "utf8")) as { reviews: ReviewRow[]; index: MediaIndexRow[]; purchases?: AgentPurchaseRow[] };
      raw.reviews.forEach((r) => m.reviews.set(r.id, r));
      raw.index.forEach((r) => m.index.set(r.id, r));
      m.purchases = raw.purchases ?? [];
    }
    g.__ppwContent = m;
  }
  return g.__ppwContent;
}

function save() {
  if (isMock) return;
  const m = local();
  mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify({ reviews: [...m.reviews.values()], index: [...m.index.values()], purchases: m.purchases }));
  renameSync(tmp, FILE);
}

type WithId<T> = T & { _id: string };

// ------------------------------------------------------------------ reviews

export async function getReview(id: string): Promise<ReviewRow | null> {
  if (mongoEnabled()) return clean<ReviewRow>(await (await col<WithId<ReviewRow>>("reviews")).findOne({ _id: id }));
  return local().reviews.get(id) ?? null;
}

export async function createReview(
  r: Pick<ReviewRow, "id" | "creator" | "playback_url" | "title" | "description" | "duration_seconds">,
): Promise<ReviewRow> {
  const row: ReviewRow = { ...r, creator: lc(r.creator), status: "queued", score: null, matches: [], note: null, error: null, created_at: nowIso(), updated_at: nowIso() };
  if (mongoEnabled()) {
    await (await col<WithId<ReviewRow>>("reviews")).replaceOne({ _id: row.id }, { ...row }, { upsert: true });
    return row;
  }
  local().reviews.set(row.id, row);
  save();
  return row;
}

export async function patchReview(id: string, patch: Partial<Omit<ReviewRow, "id" | "creator" | "created_at">>): Promise<void> {
  const full = { ...patch, updated_at: nowIso() };
  if (mongoEnabled()) {
    await (await col<WithId<ReviewRow>>("reviews")).updateOne({ _id: id }, { $set: full });
    return;
  }
  const row = local().reviews.get(id);
  if (row) {
    Object.assign(row, full);
    save();
  }
}

export async function listQueuedReviews(): Promise<ReviewRow[]> {
  if (mongoEnabled()) {
    const docs = await (await col<WithId<ReviewRow>>("reviews")).find({ status: "queued" }).sort({ created_at: 1 }).limit(20).toArray();
    return docs.map((d) => clean<ReviewRow>(d)!);
  }
  return [...local().reviews.values()].filter((r) => r.status === "queued").sort((a, b) => a.created_at.localeCompare(b.created_at));
}

// ------------------------------------------------------------------ media index

type IndexId = { id: string; video_id: string | null; transcriber: number; created_at: string };

/** Entry ids (and their video ids) without the heavy fingerprint fields. */
export async function listIndexIds(): Promise<IndexId[]> {
  const brief = (r: Pick<MediaIndexRow, "video_id" | "transcriber" | "created_at">, id: string): IndexId => ({
    id,
    video_id: r.video_id ?? null,
    transcriber: r.transcriber ?? 1,
    created_at: r.created_at,
  });
  if (mongoEnabled()) {
    const docs = await (await col<WithId<MediaIndexRow>>("media_index")).find({}, { projection: { _id: 1, video_id: 1, transcriber: 1, created_at: 1 } }).toArray();
    return docs.map((d) => brief(d, d._id));
  }
  return [...local().index.values()].map((r) => brief(r, r.id));
}

export async function getIndexEntry(id: string): Promise<MediaIndexRow | null> {
  if (mongoEnabled()) return clean<MediaIndexRow>(await (await col<WithId<MediaIndexRow>>("media_index")).findOne({ _id: id }));
  return local().index.get(id) ?? null;
}

export async function getIndexByVideo(videoId: string): Promise<MediaIndexRow | null> {
  if (mongoEnabled()) return clean<MediaIndexRow>(await (await col<WithId<MediaIndexRow>>("media_index")).findOne({ video_id: lc(videoId) }));
  return [...local().index.values()].find((r) => r.video_id === lc(videoId)) ?? null;
}

/** Published entries' transcripts, for search. */
export async function listTranscripts(): Promise<Pick<MediaIndexRow, "id" | "video_id" | "segments">[]> {
  if (mongoEnabled()) {
    const docs = await (await col<WithId<MediaIndexRow>>("media_index"))
      .find({ video_id: { $ne: null } }, { projection: { _id: 1, video_id: 1, segments: 1 } })
      .toArray();
    return docs.map((d) => ({ id: d._id, video_id: d.video_id, segments: d.segments ?? [] }));
  }
  return [...local().index.values()].filter((r) => r.video_id).map((r) => ({ id: r.id, video_id: r.video_id, segments: r.segments }));
}

export async function putIndexEntry(row: Omit<MediaIndexRow, "created_at">): Promise<void> {
  const full: MediaIndexRow = { ...row, creator: lc(row.creator), video_id: row.video_id && lc(row.video_id), created_at: nowIso() };
  if (mongoEnabled()) {
    await (await col<WithId<MediaIndexRow>>("media_index")).replaceOne({ _id: full.id }, { ...full }, { upsert: true });
    return;
  }
  local().index.set(full.id, full);
  save();
}

/** Forget a deleted video's fingerprints and transcript (search, agent API and originality checks). */
export async function deleteIndexForVideo(videoId: string): Promise<void> {
  if (mongoEnabled()) {
    await (await col<WithId<MediaIndexRow>>("media_index")).deleteMany({ video_id: lc(videoId) });
    return;
  }
  let changed = false;
  for (const [id, r] of local().index) if (r.video_id === lc(videoId)) changed = local().index.delete(id) || changed;
  if (changed) save();
}

/** Mark an indexed upload as published, so later uploads are compared against it. */
export async function linkIndexToVideo(id: string, videoId: string): Promise<void> {
  if (mongoEnabled()) {
    await (await col<WithId<MediaIndexRow>>("media_index")).updateOne({ _id: id }, { $set: { video_id: lc(videoId) } });
    return;
  }
  const row = local().index.get(id);
  if (row) {
    row.video_id = lc(videoId);
    save();
  }
}

// ------------------------------------------------------------------ agent purchases

export async function addAgentPurchase(p: Omit<AgentPurchaseRow, "created_at">): Promise<void> {
  const row: AgentPurchaseRow = { ...p, creator: lc(p.creator), payer: lc(p.payer), created_at: nowIso() };
  if (mongoEnabled()) {
    await (await col<WithId<AgentPurchaseRow>>("agent_purchases")).insertOne({ _id: row.id, ...row });
    return;
  }
  local().purchases.push(row);
  save();
}

/** Total agents have paid for a creator's videos, in USDC base units. */
export async function agentTotalForCreator(creator: string): Promise<bigint> {
  const rows = mongoEnabled()
    ? (await (await col<WithId<AgentPurchaseRow>>("agent_purchases")).find({ creator: lc(creator) }, { projection: { amount: 1 } }).toArray())
    : local().purchases.filter((p) => p.creator === lc(creator));
  return rows.reduce((a, r) => a + BigInt(r.amount), 0n);
}

// ------------------------------------------------------------------ encrypted HLS

export type HlsSegment = { name: string; duration: number };

/** A video packaged as AES-128 HLS by the worker. Each segment has its own key, derived from `key`. */
export type HlsRow = {
  /** content_cid */
  id: string;
  /** 32-byte master key (hex). Never sent to viewers; segment keys are derived from it. */
  key: string;
  storage: "r2" | "local";
  status: "packaging" | "ready";
  segments: HlsSegment[];
  target_duration: number;
  created_at: string;
};

/** Which segment keys a viewer has been given for a video, and when (ms). */
export type HlsGrantRow = { id: string; viewer: string; video_id: string; grants: Record<string, number> };

/** Receipts the contract keeps refusing, so settlement backs off instead of retrying every hour. */
export type SettleSkipRow = { id: string; count: number; last_at: string; reason: string };

type Extra = { hls: Map<string, HlsRow>; grants: Map<string, HlsGrantRow>; skips: Map<string, SettleSkipRow> };
const gx = globalThis as unknown as { __ppwContentExtra?: Extra };
const EXTRA_FILE = path.join(DATA_DIR, "ppw-content-extra.json");

function extra(): Extra {
  if (!gx.__ppwContentExtra) {
    const m: Extra = { hls: new Map(), grants: new Map(), skips: new Map() };
    if (!isMock && existsSync(EXTRA_FILE)) {
      const raw = JSON.parse(readFileSync(EXTRA_FILE, "utf8")) as { hls?: HlsRow[]; grants?: HlsGrantRow[]; skips?: SettleSkipRow[] };
      raw.hls?.forEach((r) => m.hls.set(r.id, r));
      raw.grants?.forEach((r) => m.grants.set(r.id, r));
      raw.skips?.forEach((r) => m.skips.set(r.id, r));
    }
    gx.__ppwContentExtra = m;
  }
  return gx.__ppwContentExtra;
}

function saveExtra() {
  if (isMock) return;
  const m = extra();
  mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${EXTRA_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify({ hls: [...m.hls.values()], grants: [...m.grants.values()], skips: [...m.skips.values()] }));
  renameSync(tmp, EXTRA_FILE);
}

export async function getHls(id: string): Promise<HlsRow | null> {
  if (mongoEnabled()) return clean<HlsRow>(await (await col<WithId<HlsRow>>("hls")).findOne({ _id: id }));
  return extra().hls.get(id) ?? null;
}

export async function listHlsIds(): Promise<{ id: string; status: HlsRow["status"] }[]> {
  if (mongoEnabled()) {
    const docs = await (await col<WithId<HlsRow>>("hls")).find({}, { projection: { _id: 1, status: 1 } }).toArray();
    return docs.map((d) => ({ id: d._id, status: d.status }));
  }
  return [...extra().hls.values()].map((r) => ({ id: r.id, status: r.status }));
}

export async function putHls(row: HlsRow): Promise<void> {
  if (mongoEnabled()) {
    await (await col<WithId<HlsRow>>("hls")).replaceOne({ _id: row.id }, { ...row }, { upsert: true });
    return;
  }
  extra().hls.set(row.id, row);
  saveExtra();
}

export async function deleteHls(id: string): Promise<void> {
  if (mongoEnabled()) {
    await (await col<WithId<HlsRow>>("hls")).deleteOne({ _id: id });
    return;
  }
  if (extra().hls.delete(id)) saveExtra();
}

export async function getHlsGrants(viewer: string, videoId: string): Promise<HlsGrantRow | null> {
  const id = `${lc(viewer)}:${lc(videoId)}`;
  if (mongoEnabled()) return clean<HlsGrantRow>(await (await col<WithId<HlsGrantRow>>("hls_grants")).findOne({ _id: id }));
  return extra().grants.get(id) ?? null;
}

/** Record that segment `seg` was handed to this viewer (first grant time is kept). */
export async function addHlsGrant(viewer: string, videoId: string, seg: number, at: number): Promise<void> {
  const id = `${lc(viewer)}:${lc(videoId)}`;
  if (mongoEnabled()) {
    await (await col<WithId<HlsGrantRow>>("hls_grants")).updateOne(
      { _id: id, [`grants.${seg}`]: { $exists: false } },
      { $set: { viewer: lc(viewer), video_id: lc(videoId), [`grants.${seg}`]: at } },
      { upsert: true },
    ).catch((e: { code?: number }) => {
      if (e.code !== 11000) throw e; // already granted (the filter didn't match an existing doc)
    });
    return;
  }
  const m = extra();
  const row = m.grants.get(id) ?? { id, viewer: lc(viewer), video_id: lc(videoId), grants: {} };
  row.grants[String(seg)] ??= at;
  m.grants.set(id, row);
  saveExtra();
}

export async function listSettleSkips(): Promise<SettleSkipRow[]> {
  if (mongoEnabled()) return (await (await col<WithId<SettleSkipRow>>("settle_skips")).find({}).toArray()).map((d) => ({ ...clean<SettleSkipRow>(d)!, id: d._id }));
  return [...extra().skips.values()];
}

export async function recordSettleSkip(id: string, reason: string): Promise<void> {
  const now = nowIso();
  if (mongoEnabled()) {
    await (await col<WithId<SettleSkipRow>>("settle_skips")).updateOne({ _id: id }, { $inc: { count: 1 }, $set: { last_at: now, reason } }, { upsert: true });
    return;
  }
  const m = extra();
  const row = m.skips.get(id) ?? { id, count: 0, last_at: now, reason };
  m.skips.set(id, { ...row, count: row.count + 1, last_at: now, reason });
  saveExtra();
}

export async function clearSettleSkip(id: string): Promise<void> {
  if (mongoEnabled()) {
    await (await col<WithId<SettleSkipRow>>("settle_skips")).deleteOne({ _id: id });
    return;
  }
  if (extra().skips.delete(id)) saveExtra();
}
