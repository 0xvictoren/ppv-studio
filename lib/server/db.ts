import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { computeVideoId, ZERO_ADDRESS } from "../contract";
import { isMock } from "../env";
import * as mock from "../mock/contract";
import { DEMO_CREATOR_KEY, SAMPLE_VIDEOS } from "../samples";
import * as mg from "./db-mongo";
import { mongoEnabled } from "./mongo";

// Metadata store.
// - MongoDB Atlas when MONGODB_URI is set (recommended on Vercel).
// - Supabase when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set.
// - Otherwise a JSON file at $PPW_DATA_DIR/ppw-db.json (default ./data), for self-hosting.
// - Mock mode (tests) uses memory seeded with sample videos.
// Amounts are decimal strings of USDC base units.

export type VideoRow = {
  id: string;
  creator: string;
  title: string;
  description: string;
  category: string;
  /** Creator opted in to "Share and earn" referrals for this video. */
  referrals_enabled: boolean;
  thumbnail_url: string | null;
  content_cid: string;
  playback_url: string;
  price_per_hour: string;
  duration_seconds: number;
  active: boolean;
  register_tx: string | null;
  created_at: string;
};

export type ReceiptRow = {
  viewer: string;
  creator: string;
  referrer: string; // zero address when nobody referred the viewer
  cumulative_amount: string;
  deadline: string;
  signature: string;
  signer: string;
  settled_amount: string;
  updated_at: string;
};

export type WatchSessionRow = {
  id: string;
  viewer: string;
  creator: string;
  referrer: string;
  video_id: string;
  seconds: number; // paid seconds, credited from signed receipts
  free_seconds?: number; // replay time already paid for (or under a pass), credited by wall clock
  amount: string;
  started_at: string;
  updated_at: string;
};

/**
 * Per (viewer, video) watch progress for one 30-day window: which seconds of the video the
 * viewer has already paid for (bitmap, 1 bit per second), and whether they hold a free-replay pass.
 */
export type ProgressRow = {
  viewer: string;
  video_id: string;
  window_start: string; // when the viewer first started this video in the current window
  coverage: string; // base64 bitmap, bit i = second i paid for
  covered_seconds: number;
  completed_at: string | null;
  pass_until: string | null; // free replays (and re-downloads) until this time
  downloaded_at: string | null;
  updated_at: string;
};

export type SettlementRunRow = {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: "success" | "noop" | "error";
  receipts_count: number;
  total_amount: string;
  tx_hash: string | null;
  error: string | null;
};

const lc = (s: string) => s.toLowerCase();
const ZERO = ZERO_ADDRESS.toLowerCase();
const rkey = (viewer: string, creator: string, referrer: string) => `${lc(viewer)}:${lc(creator)}:${lc(referrer || ZERO)}`;
const nowIso = () => new Date().toISOString();
const str = (v: unknown) => (v === null || v === undefined ? "0" : String(v));

export const DATA_DIR = path.resolve(process.env.PPW_DATA_DIR || "data");

// ------------------------------------------------------------------ backends

type Local = {
  videos: Map<string, VideoRow>;
  receipts: Map<string, ReceiptRow>;
  sessions: Map<string, WatchSessionRow>;
  progress: Map<string, ProgressRow>;
  runs: SettlementRunRow[];
};

const g = globalThis as unknown as { __ppwLocal?: Local; __ppwSupabase?: SupabaseClient };

function supabase(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  g.__ppwSupabase ??= createClient(url, key, { auth: { persistSession: false } });
  return g.__ppwSupabase;
}

const DB_FILE = path.join(DATA_DIR, "ppw-db.json");
const persistent = !isMock;

function local(): Local {
  if (!g.__ppwLocal) {
    const m: Local = { videos: new Map(), receipts: new Map(), sessions: new Map(), progress: new Map(), runs: [] };
    if (persistent && existsSync(DB_FILE)) {
      const raw = JSON.parse(readFileSync(DB_FILE, "utf8")) as {
        videos: VideoRow[];
        receipts: ReceiptRow[];
        sessions: WatchSessionRow[];
        progress?: ProgressRow[];
        runs: SettlementRunRow[];
      };
      raw.videos.forEach((v) => m.videos.set(v.id, { ...v, category: v.category ?? "other", referrals_enabled: v.referrals_enabled ?? false }));
      raw.receipts.forEach((r) => m.receipts.set(rkey(r.viewer, r.creator, r.referrer), { ...r, referrer: r.referrer ?? ZERO }));
      raw.sessions.forEach((s) => m.sessions.set(s.id, { ...s, referrer: s.referrer ?? ZERO }));
      (raw.progress ?? []).forEach((p) => m.progress.set(`${p.viewer}:${p.video_id}`, p));
      m.runs = raw.runs ?? [];
    }
    if (isMock) seedMock(m);
    g.__ppwLocal = m;
  }
  return g.__ppwLocal;
}

export async function getWatchSession(id: string): Promise<WatchSessionRow | null> {
  if (mongoEnabled()) {
    const row = await mg.getSession(id);
    return row ? normSession(row) : null;
  }
  const sb = supabase();
  if (sb) {
    const row = check(await sb.from("watch_sessions").select("*").eq("id", id).maybeSingle());
    return row ? normSession(row as WatchSessionRow) : null;
  }
  return local().sessions.get(id) ?? null;
}

/** Write-through: atomically replace the JSON file after every mutation. */
function save() {
  if (!persistent) return;
  const m = local();
  mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${DB_FILE}.tmp`;
  writeFileSync(
    tmp,
    JSON.stringify({
      videos: [...m.videos.values()],
      receipts: [...m.receipts.values()],
      sessions: [...m.sessions.values()],
      progress: [...m.progress.values()],
      runs: m.runs.slice(0, 500),
    }),
  );
  renameSync(tmp, DB_FILE);
}

/** Tests only: sample videos registered on the simulated chain. */
function seedMock(m: Local) {
  const creator = privateKeyToAccount(DEMO_CREATOR_KEY).address;
  SAMPLE_VIDEOS.forEach((v, i) => {
    const id = lc(computeVideoId(creator, v.cid));
    let tx: string | null = null;
    try {
      tx = mock.write("registerVideo", [id as Hex, v.pricePerHour], creator);
    } catch {
      /* already registered */
    }
    m.videos.set(id, {
      id,
      creator: lc(creator),
      title: v.title,
      description: v.description,
      category: v.category,
      referrals_enabled: true,
      thumbnail_url: v.thumbnailUrl,
      content_cid: v.cid,
      playback_url: v.playbackUrl,
      price_per_hour: v.pricePerHour.toString(),
      duration_seconds: v.durationSeconds,
      active: true,
      register_tx: tx,
      created_at: new Date(Date.now() - (3 - i) * 86_400_000).toISOString(),
    });
  });
}

/** Tests only: put the sample videos into an empty Mongo database. */
let mongoSeeded: Promise<void> | null = null;
function ensureMongoSeed(): Promise<void> {
  if (!isMock) return Promise.resolve();
  mongoSeeded ??= (async () => {
    if ((await mg.countVideos()) > 0) return;
    const m: Local = { videos: new Map(), receipts: new Map(), sessions: new Map(), progress: new Map(), runs: [] };
    seedMock(m);
    for (const v of m.videos.values()) await mg.putVideo(v);
  })();
  return mongoSeeded;
}

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(`Database error: ${res.error.message}`);
  return res.data;
}

const normVideo = (r: VideoRow): VideoRow => ({ ...r, category: r.category ?? "other", referrals_enabled: r.referrals_enabled ?? false, price_per_hour: str(r.price_per_hour) });
const normReceipt = (r: ReceiptRow): ReceiptRow => ({
  ...r,
  referrer: r.referrer ?? ZERO,
  cumulative_amount: str(r.cumulative_amount),
  settled_amount: str(r.settled_amount),
  deadline: str(r.deadline),
});
const normSession = (r: WatchSessionRow): WatchSessionRow => ({ ...r, referrer: r.referrer ?? ZERO, amount: str(r.amount) });

// ------------------------------------------------------------------ videos

export async function listVideos(opts: { creator?: string; category?: string; includeInactive?: boolean } = {}): Promise<VideoRow[]> {
  const sb = supabase();
  let rows: VideoRow[];
  if (mongoEnabled()) {
    await ensureMongoSeed();
    rows = (await mg.listVideos(opts)).map(normVideo);
  } else if (sb) {
    let q = sb.from("videos").select("*").order("created_at", { ascending: false });
    if (opts.creator) q = q.eq("creator", lc(opts.creator));
    if (opts.category) q = q.eq("category", opts.category);
    rows = (check(await q) ?? []).map(normVideo);
  } else {
    rows = [...local().videos.values()]
      .filter((v) => (!opts.creator || v.creator === lc(opts.creator)) && (!opts.category || v.category === opts.category))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  return opts.includeInactive ? rows : rows.filter((v) => v.active);
}

export async function getVideo(id: string): Promise<VideoRow | null> {
  if (mongoEnabled()) {
    await ensureMongoSeed();
    const row = await mg.getVideo(id);
    return row ? normVideo(row) : null;
  }
  const sb = supabase();
  if (sb) {
    const row = check(await sb.from("videos").select("*").eq("id", lc(id)).maybeSingle());
    return row ? normVideo(row as VideoRow) : null;
  }
  return local().videos.get(lc(id)) ?? null;
}

export async function insertVideo(v: Omit<VideoRow, "created_at" | "active"> & { active?: boolean }): Promise<VideoRow> {
  const row: VideoRow = { active: true, ...v, id: lc(v.id), creator: lc(v.creator), created_at: nowIso() };
  if (mongoEnabled()) {
    await mg.putVideo(row);
    return row;
  }
  const sb = supabase();
  if (sb) return normVideo(check(await sb.from("videos").upsert(row).select().single()) as VideoRow);
  local().videos.set(row.id, row);
  save();
  return row;
}

export async function updateVideo(id: string, patch: Partial<Pick<VideoRow, "price_per_hour" | "active" | "referrals_enabled" | "duration_seconds">>) {
  if (mongoEnabled()) return mg.patchVideo(id, patch);
  const sb = supabase();
  if (sb) {
    check(await sb.from("videos").update(patch).eq("id", lc(id)));
    return;
  }
  const row = local().videos.get(lc(id));
  if (row) {
    Object.assign(row, patch);
    save();
  }
}

// ------------------------------------------------------------------ receipts

export async function getReceipt(viewer: string, creator: string, referrer: string = ZERO): Promise<ReceiptRow | null> {
  if (mongoEnabled()) {
    const row = await mg.getReceipt(viewer, creator, referrer || ZERO);
    return row ? normReceipt(row) : null;
  }
  const sb = supabase();
  if (sb) {
    const row = check(
      await sb.from("receipts").select("*").eq("viewer", lc(viewer)).eq("creator", lc(creator)).eq("referrer", lc(referrer)).maybeSingle(),
    );
    return row ? normReceipt(row as ReceiptRow) : null;
  }
  return local().receipts.get(rkey(viewer, creator, referrer)) ?? null;
}

export async function listReceipts(filter: { viewer?: string; creator?: string; referrer?: string } = {}): Promise<ReceiptRow[]> {
  if (mongoEnabled()) return (await mg.listReceipts(filter)).map(normReceipt);
  const sb = supabase();
  if (sb) {
    let q = sb.from("receipts").select("*");
    if (filter.viewer) q = q.eq("viewer", lc(filter.viewer));
    if (filter.creator) q = q.eq("creator", lc(filter.creator));
    if (filter.referrer) q = q.eq("referrer", lc(filter.referrer));
    return (check(await q) ?? []).map(normReceipt);
  }
  return [...local().receipts.values()].filter(
    (r) =>
      (!filter.viewer || r.viewer === lc(filter.viewer)) &&
      (!filter.creator || r.creator === lc(filter.creator)) &&
      (!filter.referrer || r.referrer === lc(filter.referrer)),
  );
}

/**
 * Store the receipt only if it does not lower the stored cumulative amount.
 * Returns false when a newer (higher) receipt is already stored.
 */
export async function upsertReceipt(r: Omit<ReceiptRow, "updated_at" | "settled_amount">): Promise<boolean> {
  const existing = await getReceipt(r.viewer, r.creator, r.referrer);
  if (existing && BigInt(existing.cumulative_amount) > BigInt(r.cumulative_amount)) return false;
  const row: ReceiptRow = {
    ...r,
    viewer: lc(r.viewer),
    creator: lc(r.creator),
    referrer: lc(r.referrer || ZERO),
    signer: lc(r.signer),
    settled_amount: existing?.settled_amount ?? "0",
    updated_at: nowIso(),
  };
  if (mongoEnabled()) return mg.putReceipt(row);
  const sb = supabase();
  if (sb) {
    // Conditional write guards against a concurrent lower receipt racing in.
    if (existing) {
      check(
        await sb
          .from("receipts")
          .update(row)
          .eq("viewer", row.viewer)
          .eq("creator", row.creator)
          .eq("referrer", row.referrer)
          .lte("cumulative_amount", row.cumulative_amount),
      );
    } else {
      check(await sb.from("receipts").upsert(row));
    }
    return true;
  }
  local().receipts.set(rkey(row.viewer, row.creator, row.referrer), row);
  save();
  return true;
}

export async function setSettledAmount(viewer: string, creator: string, referrer: string, settled: bigint) {
  if (mongoEnabled()) return mg.setSettled(viewer, creator, referrer, settled.toString());
  const sb = supabase();
  if (sb) {
    check(
      await sb
        .from("receipts")
        .update({ settled_amount: settled.toString() })
        .eq("viewer", lc(viewer))
        .eq("creator", lc(creator))
        .eq("referrer", lc(referrer)),
    );
    return;
  }
  const row = local().receipts.get(rkey(viewer, creator, referrer));
  if (row) {
    row.settled_amount = settled.toString();
    save();
  }
}

// ------------------------------------------------------------------ watch sessions

export async function upsertWatchSession(s: Omit<WatchSessionRow, "started_at" | "updated_at">) {
  const sb = supabase();
  const row = { ...s, viewer: lc(s.viewer), creator: lc(s.creator), referrer: lc(s.referrer || ZERO), video_id: lc(s.video_id), updated_at: nowIso() };
  if (mongoEnabled()) {
    const existing = await mg.getSession(s.id);
    if (existing && existing.seconds > s.seconds) return; // never move backwards
    await mg.putSession({ started_at: existing?.started_at ?? nowIso(), ...row });
    return;
  }
  if (sb) {
    const existing = check(await sb.from("watch_sessions").select("seconds").eq("id", s.id).maybeSingle()) as { seconds: number } | null;
    if (existing && existing.seconds > s.seconds) return; // never move backwards
    check(await sb.from("watch_sessions").upsert(row));
    return;
  }
  const m = local();
  const existing = m.sessions.get(s.id);
  if (existing && existing.seconds > s.seconds) return;
  m.sessions.set(s.id, { started_at: existing?.started_at ?? nowIso(), ...row });
  save();
}

export async function listWatchSessions(filter: { viewer?: string; creator?: string; videoId?: string } = {}): Promise<WatchSessionRow[]> {
  if (mongoEnabled()) return (await mg.listSessions(filter)).map(normSession);
  const sb = supabase();
  if (sb) {
    let q = sb.from("watch_sessions").select("*");
    if (filter.viewer) q = q.eq("viewer", lc(filter.viewer));
    if (filter.creator) q = q.eq("creator", lc(filter.creator));
    if (filter.videoId) q = q.eq("video_id", lc(filter.videoId));
    return (check(await q) ?? []).map(normSession);
  }
  return [...local().sessions.values()].filter(
    (s) =>
      (!filter.viewer || s.viewer === lc(filter.viewer)) &&
      (!filter.creator || s.creator === lc(filter.creator)) &&
      (!filter.videoId || s.video_id === lc(filter.videoId)),
  );
}

// ------------------------------------------------------------------ watch progress

export async function getProgress(viewer: string, videoId: string): Promise<ProgressRow | null> {
  if (mongoEnabled()) return mg.getProgress(viewer, videoId);
  const sb = supabase();
  if (sb) {
    const row = check(await sb.from("watch_progress").select("*").eq("viewer", lc(viewer)).eq("video_id", lc(videoId)).maybeSingle());
    return (row as ProgressRow) ?? null;
  }
  return local().progress.get(`${lc(viewer)}:${lc(videoId)}`) ?? null;
}

export async function saveProgress(p: Omit<ProgressRow, "updated_at">): Promise<ProgressRow> {
  const row: ProgressRow = { ...p, viewer: lc(p.viewer), video_id: lc(p.video_id), updated_at: nowIso() };
  if (mongoEnabled()) {
    await mg.putProgress(row);
    return row;
  }
  const sb = supabase();
  if (sb) {
    check(await sb.from("watch_progress").upsert(row));
    return row;
  }
  local().progress.set(`${row.viewer}:${row.video_id}`, row);
  save();
  return row;
}

// ------------------------------------------------------------------ settlement runs

export async function insertSettlementRun(run: Omit<SettlementRunRow, "id">): Promise<void> {
  if (mongoEnabled()) return mg.addRun(run);
  const sb = supabase();
  if (sb) {
    check(await sb.from("settlement_runs").insert(run));
    return;
  }
  const m = local();
  m.runs.unshift({ id: (m.runs[0]?.id ?? 0) + 1, ...run });
  save();
}

export async function lastSettlementRun(): Promise<SettlementRunRow | null> {
  if (mongoEnabled()) return mg.lastRun();
  const sb = supabase();
  if (sb) {
    const row = check(
      await sb.from("settlement_runs").select("*").neq("status", "error").order("started_at", { ascending: false }).limit(1).maybeSingle(),
    );
    return (row as SettlementRunRow) ?? null;
  }
  return local().runs.find((r) => r.status !== "error") ?? null;
}

export function checksum(a: string) {
  return getAddress(a);
}
