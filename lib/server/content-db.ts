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

/** Entry ids (and their video ids) without the heavy fingerprint fields. */
export async function listIndexIds(): Promise<{ id: string; video_id: string | null }[]> {
  if (mongoEnabled()) {
    const docs = await (await col<WithId<MediaIndexRow>>("media_index")).find({}, { projection: { _id: 1, video_id: 1 } }).toArray();
    return docs.map((d) => ({ id: d._id, video_id: d.video_id ?? null }));
  }
  return [...local().index.values()].map((r) => ({ id: r.id, video_id: r.video_id }));
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
