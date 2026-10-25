/**
 * Switch the metadata store to a new contract deployment. Run with the server STOPPED (the file
 * store keeps the DB in memory and would overwrite this file).
 *
 *   npx tsx scripts/migrate-contract.ts 0xOLD_CONTRACT
 *
 * Signed receipts are bound to the old contract's EIP-712 domain, so they can never settle on the
 * new one, and their cumulative totals must not carry over (that would re-charge viewers). The
 * agent purchase ledger goes too: agent receipts sign each creator's all-time agent total, so
 * keeping it would pay creators again on the new contract for purchases the old one settled.
 * Both are archived, never deleted. Nothing else changes: videos, watch progress, passes, ratings,
 * reviews, transcripts and settlement history stay as they are. Creators re-publish their videos
 * on the new contract from the dashboard; viewers withdraw old balances from the Wallet page.
 *
 * MongoDB (MONGODB_URI set): moves `receipts` and `agent_purchases` into
 * `receipts_archive_<old>` / `agent_purchases_archive_<old>`.
 * File store: archives into $PPW_DATA_DIR/archive/.
 * Supabase: run `create table receipts_archive as select * from receipts; delete from receipts;`
 *
 * Moving to another chain (testnet -> mainnet): add --chain-switch (MongoDB only). Paid seconds,
 * passes and downloads were bought with test USDC and must not play free on mainnet, and testnet
 * earnings shouldn't show as real ones, so watch progress, watch sessions, settlement history,
 * settle skips and HLS key grants are archived too. Videos, reviews and transcripts stay.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { MongoClient } from "mongodb";

for (const file of [".env.local", ".env"]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const old = (process.argv[2] ?? "").toLowerCase();
const chainSwitch = process.argv.includes("--chain-switch");
const COLLECTIONS = ["receipts", "agent_purchases", ...(chainSwitch ? ["watch_progress", "watch_sessions", "settlement_runs", "settle_skips", "hls_grants"] : [])];
if (!/^0x[0-9a-f]{40}$/.test(old)) throw new Error("Pass the OLD contract address");
const stamp = new Date().toISOString();

async function mongo(uri: string) {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  await client.connect();
  try {
    const db = client.db(process.env.MONGODB_DB || "payperwatch");
    for (const name of COLLECTIONS) {
      const docs = await db.collection(name).find({}).toArray();
      const archive = `${name}_archive_${old}`;
      if (docs.length) await db.collection(archive).insertMany(docs.map((d) => ({ ...d, archived_at: stamp })));
      // Only delete what was copied.
      const { deletedCount } = await db.collection(name).deleteMany({ _id: { $in: docs.map((d) => d._id) } });
      console.log(`${name}: archived ${docs.length} to ${archive}, cleared ${deletedCount}.`);
    }
  } finally {
    await client.close();
  }
}

function files() {
  const dir = path.resolve(process.env.PPW_DATA_DIR || "data");
  const dbFile = path.join(dir, "ppw-db.json");
  const contentFile = path.join(dir, "ppw-content.json");
  const tag = stamp.replace(/[:.]/g, "-");
  mkdirSync(path.join(dir, "archive"), { recursive: true });
  if (existsSync(dbFile)) {
    const db = JSON.parse(readFileSync(dbFile, "utf8")) as { receipts: unknown[]; [k: string]: unknown };
    copyFileSync(dbFile, path.join(dir, "archive", `ppw-db-before-migration-${tag}.json`));
    writeFileSync(path.join(dir, "archive", `receipts-${old}.json`), JSON.stringify(db.receipts, null, 2));
    console.log(`receipts: archived ${db.receipts.length} from ${old}.`);
    db.receipts = [];
    writeFileSync(dbFile, JSON.stringify(db));
  }
  if (existsSync(contentFile)) {
    const c = JSON.parse(readFileSync(contentFile, "utf8")) as { purchases?: unknown[]; [k: string]: unknown };
    copyFileSync(contentFile, path.join(dir, "archive", `ppw-content-before-migration-${tag}.json`));
    writeFileSync(path.join(dir, "archive", `agent-purchases-${old}.json`), JSON.stringify(c.purchases ?? [], null, 2));
    console.log(`agent purchases: archived ${(c.purchases ?? []).length} from ${old}.`);
    c.purchases = [];
    writeFileSync(contentFile, JSON.stringify(c));
  }
}

async function main() {
  if (process.env.MONGODB_URI) await mongo(process.env.MONGODB_URI);
  else if (chainSwitch) throw new Error("--chain-switch needs MongoDB (MONGODB_URI)");
  else files();
  console.log(chainSwitch ? "Done. Videos, reviews and transcripts kept." : "Done. Videos, progress, passes, ratings, reviews and transcripts kept.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
