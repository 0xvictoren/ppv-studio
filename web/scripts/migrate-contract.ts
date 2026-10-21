/**
 * Switch the file store to a new contract deployment. Run with the server STOPPED (it keeps the
 * DB in memory and would overwrite this file).
 *
 *   npx tsx scripts/migrate-contract.ts 0xOLD_CONTRACT
 *
 * Signed receipts are bound to the old contract's EIP-712 domain, so they can never settle on the
 * new one, and their cumulative totals must not carry over (that would re-charge viewers). They
 * are moved to data/archive/receipts-<old>.json. Nothing else changes: videos, watch progress,
 * passes, ratings and settlement history stay as they are. Creators re-publish their videos on
 * the new contract from the dashboard; viewers withdraw old balances from the Wallet page.
 *
 * Supabase: run `create table receipts_archive as select * from receipts; delete from receipts;`
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const old = (process.argv[2] ?? "").toLowerCase();
if (!/^0x[0-9a-f]{40}$/.test(old)) throw new Error("Pass the OLD contract address");

const dir = path.resolve(process.env.PPW_DATA_DIR || "data");
const file = path.join(dir, "ppw-db.json");
if (!existsSync(file)) {
  console.log("No file store found; nothing to migrate.");
  process.exit(0);
}
const db = JSON.parse(readFileSync(file, "utf8")) as { receipts: unknown[]; [k: string]: unknown };
mkdirSync(path.join(dir, "archive"), { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
copyFileSync(file, path.join(dir, "archive", `ppw-db-before-migration-${stamp}.json`));
writeFileSync(path.join(dir, "archive", `receipts-${old}.json`), JSON.stringify(db.receipts, null, 2));
console.log(`Archived ${db.receipts.length} receipt(s) from ${old}. Full backup in data/archive/.`);
db.receipts = [];
writeFileSync(file, JSON.stringify(db));
console.log("Receipts cleared for the new contract. Videos, progress, passes and ratings kept.");
