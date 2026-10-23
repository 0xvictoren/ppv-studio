import "server-only";
import { MongoClient, type Collection, type Db, type Document } from "mongodb";

// MongoDB Atlas backend for the metadata store (used when MONGODB_URI is set).
// The client is cached on globalThis so serverless invocations on Vercel reuse one connection pool.

const g = globalThis as unknown as { __ppwMongo?: Promise<Db> };

export function mongoEnabled() {
  return !!process.env.MONGODB_URI;
}

async function connect(): Promise<Db> {
  const client = new MongoClient(process.env.MONGODB_URI!, { maxPoolSize: 10, serverSelectionTimeoutMS: 8_000 });
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || "payperwatch");
  await Promise.all([
    db.collection("videos").createIndexes([{ key: { creator: 1 } }, { key: { category: 1 } }, { key: { created_at: -1 } }]),
    db.collection("receipts").createIndexes([{ key: { viewer: 1 } }, { key: { creator: 1 } }, { key: { referrer: 1 } }]),
    db.collection("watch_sessions").createIndexes([{ key: { video_id: 1 } }, { key: { viewer: 1 } }, { key: { creator: 1 } }]),
    db.collection("settlement_runs").createIndexes([{ key: { started_at: -1 } }]),
    db.collection("reviews").createIndexes([{ key: { status: 1 } }, { key: { creator: 1 } }]),
    db.collection("media_index").createIndexes([{ key: { video_id: 1 } }]),
    db.collection("agent_purchases").createIndexes([{ key: { creator: 1 } }]),
    db.collection("hls_grants").createIndexes([{ key: { viewer: 1 } }]),
  ]);
  return db;
}

export async function mongo(): Promise<Db> {
  g.__ppwMongo ??= connect().catch((e) => {
    g.__ppwMongo = undefined; // retry on the next request
    throw e;
  });
  return g.__ppwMongo;
}

export async function col<T extends Document>(
  name: "videos" | "receipts" | "watch_sessions" | "watch_progress" | "settlement_runs" | "reviews" | "media_index" | "agent_purchases" | "hls" | "hls_grants" | "settle_skips",
): Promise<Collection<T>> {
  return (await mongo()).collection<T>(name);
}

/** Strip Mongo's _id (and internal sort keys) so rows match the other backends exactly. */
export function clean<T>(doc: (T & { _id?: unknown; cum_sort?: unknown }) | null): T | null {
  if (!doc) return null;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _id, cum_sort, ...rest } = doc;
  return rest as T;
}
