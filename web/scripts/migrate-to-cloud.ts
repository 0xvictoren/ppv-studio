/**
 * One-time move from the self-hosted file store (data/) to MongoDB Atlas + Cloudflare R2.
 *
 *   npx tsx scripts/migrate-to-cloud.ts            # dry run: shows what would move
 *   npx tsx scripts/migrate-to-cloud.ts --apply    # does it
 *
 * Reads MONGODB_URI, MONGODB_DB, R2_* from .env.local. Uploads every local video in
 * data/uploads to R2 (videos/<creator>/<file>), rewrites its playback URL to r2:<key>, then
 * copies all videos, receipts, watch sessions, progress and settlement runs into MongoDB.
 * Safe to re-run: existing documents are replaced, not duplicated. Nothing local is deleted.
 */
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { Decimal128, MongoClient } from "mongodb";

for (const file of [".env.local", ".env"]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is required (set it in .env.local)`);
  return v;
};

type Row = Record<string, unknown> & { id?: string };
const TYPES: Record<string, string> = { mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", mkv: "video/x-matroska", ogv: "video/ogg" };

async function main() {
  const apply = process.argv.includes("--apply");
  const dir = path.resolve(process.env.PPW_DATA_DIR || "data");
  const dbFile = path.join(dir, "ppw-db.json");
  if (!existsSync(dbFile)) throw new Error(`No ${dbFile} to migrate`);
  const data = JSON.parse(readFileSync(dbFile, "utf8")) as { videos: Row[]; receipts: Row[]; sessions: Row[]; progress?: Row[]; runs?: Row[] };

  const s3 = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT || `https://${need("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
    forcePathStyle: !!process.env.R2_ENDPOINT,
    credentials: { accessKeyId: need("R2_ACCESS_KEY_ID"), secretAccessKey: need("R2_SECRET_ACCESS_KEY") },
  });
  const bucket = need("R2_BUCKET");

  // 1. Videos stored on disk -> R2
  for (const v of data.videos) {
    const m = String(v.playback_url).match(/^\/media\/([0-9a-f-]{36})\.([a-z0-9]{2,4})$/);
    if (!m) continue;
    const local = path.join(dir, "uploads", `${m[1]}.${m[2]}`);
    const key = `videos/${v.creator}/${m[1]}.${m[2]}`;
    const size = existsSync(local) ? statSync(local).size : 0;
    console.log(`${apply ? "Uploading" : "Would upload"} "${v.title}" (${(size / 1e6).toFixed(0)} MB) -> r2:${key}`);
    if (!size) {
      console.warn(`  missing file ${local}; skipping`);
      continue;
    }
    if (apply) {
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: createReadStream(local), ContentLength: size, ContentType: TYPES[m[2]] ?? "video/mp4" }));
      v.playback_url = `r2:${key}`;
    }
  }

  // 2. Metadata -> MongoDB
  console.log(
    `${apply ? "Copying" : "Would copy"} ${data.videos.length} videos, ${data.receipts.length} receipts, ${data.sessions.length} sessions, ${(data.progress ?? []).length} progress rows, ${(data.runs ?? []).length} settlement runs to MongoDB`,
  );
  if (!apply) {
    console.log("\nDry run only. Re-run with --apply.");
    return;
  }
  const client = new MongoClient(need("MONGODB_URI"));
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || "payperwatch");
  const put = async (name: string, rows: Row[], idOf: (r: Row) => string, extra: (r: Row) => Row = () => ({})) => {
    for (const r of rows) await db.collection(name).replaceOne({ _id: idOf(r) as never }, { ...r, ...extra(r) }, { upsert: true });
  };
  await put("videos", data.videos, (r) => String(r.id));
  await put("receipts", data.receipts, (r) => `${r.viewer}:${r.creator}:${r.referrer}`, (r) => ({ cum_sort: Decimal128.fromString(String(r.cumulative_amount)) as never }));
  await put("watch_sessions", data.sessions, (r) => String(r.id));
  await put("watch_progress", data.progress ?? [], (r) => `${r.viewer}:${r.video_id}`);
  for (const run of data.runs ?? []) await db.collection("settlement_runs").updateOne({ id: run.id }, { $set: run }, { upsert: true });
  await client.close();
  console.log("\nDone. Set NEXT_PUBLIC_STORAGE_PROVIDER=r2 and MONGODB_URI on Vercel; your local data/ folder is untouched.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
