/**
 * PayPerWatch v2 hourly settler
 *
 * Loads the latest receipt per (viewer, creator, referrer) from the Supabase
 * `receipts` table, filters those whose cumulativeAmount exceeds the on-chain
 * settled amount, then calls settleBatch on the contract.
 *
 * Receipts with referrer == address(0) are placed FIRST in each batch so that
 * a referrer's own viewing settles before any receipt whose referral validity
 * depends on paidTo[referrer][creator] > 0.
 *
 * Env vars required:
 *   SETTLER_PRIVATE_KEY     — EOA private key (hex, 0x-prefixed)
 *   SUPABASE_URL            — Supabase project URL
 *   SUPABASE_SERVICE_KEY    — Supabase service role key (never the anon key)
 *   PPW_CONTRACT            — PayPerWatch v2 contract address (0x...)
 *   ARC_RPC                 — Arc RPC endpoint (defaults to testnet)
 *   ARC_CHAIN_ID            — Arc chain ID (defaults to 5042002 for testnet)
 *
 * Run once:
 *   bun run scripts/settler.ts
 *
 * Run hourly with node-cron (install: bun add node-cron):
 *   bun run scripts/settler.ts --cron
 *
 * Or drop this file into a Vercel Cron handler and call runSettle() directly.
 */

import { createClient } from "@supabase/supabase-js";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  getAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

const CONTRACT_ADDRESS = getAddress(
  process.env.PPW_CONTRACT ??
    "0xdde5bd885455291429ae262a06d1aabaddf1c89b" // Arc Testnet v2
);
const ARC_RPC = process.env.ARC_RPC ?? "https://rpc.testnet.arc.io";
const ARC_CHAIN_ID = Number(process.env.ARC_CHAIN_ID ?? "5042002");

// Minimal ABI — only the pieces the settler needs.
// settled() is now 3-arg in v2: settled(viewer, creator, referrer).
const PPW_ABI = parseAbi([
  "function settled(address viewer, address creator, address referrer) view returns (uint256)",
  "function settleBatch((address viewer, address creator, address referrer, uint256 cumulativeAmount, uint64 deadline)[] rs, bytes[] sigs) external",
]);

// ---------------------------------------------------------------------------
// Types matching the Supabase receipts table (v2)
// ---------------------------------------------------------------------------

interface ReceiptRow {
  viewer: string;              // checksummed address
  creator: string;             // checksummed address
  referrer: string;            // checksummed address or "0x0000...0000"
  cumulative_amount: string;   // decimal string (stored as text to avoid JS precision loss)
  deadline: number;            // unix seconds (int8 in Supabase)
  signature: string;           // 0x-prefixed hex bytes
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalise a referrer string to a checksummed address, defaulting to zero. */
function normaliseReferrer(raw: string): `0x${string}` {
  if (!raw || raw === "0x0" || raw.toLowerCase() === ZERO_ADDRESS) {
    return ZERO_ADDRESS;
  }
  return getAddress(raw);
}

/** True when the receipt has no referrer (lane 0). */
function isNoReferrer(r: ReceiptRow): boolean {
  return normaliseReferrer(r.referrer) === ZERO_ADDRESS;
}

// ---------------------------------------------------------------------------
// Main settle job
// ---------------------------------------------------------------------------

export async function runSettle(): Promise<void> {
  const privateKey = process.env.SETTLER_PRIVATE_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;

  if (!privateKey) throw new Error("Missing SETTLER_PRIVATE_KEY");
  if (!supabaseUrl) throw new Error("Missing SUPABASE_URL");
  if (!supabaseKey) throw new Error("Missing SUPABASE_SERVICE_KEY");

  console.log(`[settler] Starting settle run at ${new Date().toISOString()}`);
  console.log(`[settler] Contract: ${CONTRACT_ADDRESS}  Chain: ${ARC_CHAIN_ID}`);

  // -------------------------------------------------------------------------
  // 1. Load latest receipt per (viewer, creator, referrer) from Supabase
  // -------------------------------------------------------------------------
  const supabase = createClient(supabaseUrl, supabaseKey);

  const { data: rows, error } = await supabase
    .from("receipts")
    .select("viewer, creator, referrer, cumulative_amount, deadline, signature");

  if (error) {
    throw new Error(`Supabase query failed: ${error.message}`);
  }
  if (!rows || rows.length === 0) {
    console.log("[settler] No receipts found. Exiting.");
    return;
  }

  const receipts = rows as ReceiptRow[];
  console.log(`[settler] Loaded ${receipts.length} receipt(s) from Supabase.`);

  // -------------------------------------------------------------------------
  // 2. For each receipt, read settled(viewer, creator, referrer) on-chain
  // -------------------------------------------------------------------------
  const arcChain = {
    id: ARC_CHAIN_ID,
    name: ARC_CHAIN_ID === 5042 ? "Arc" : "Arc Testnet",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [ARC_RPC] } },
  } as const;

  const publicClient = createPublicClient({
    chain: arcChain,
    transport: http(ARC_RPC),
  });

  const onChainSettled: bigint[] = await Promise.all(
    receipts.map((r) =>
      publicClient.readContract({
        address: CONTRACT_ADDRESS,
        abi: PPW_ABI,
        functionName: "settled",
        args: [
          getAddress(r.viewer),
          getAddress(r.creator),
          normaliseReferrer(r.referrer),
        ],
      })
    )
  );

  // -------------------------------------------------------------------------
  // 3. Filter: only receipts where cumulativeAmount > settled on-chain
  // -------------------------------------------------------------------------
  const toSettle: ReceiptRow[] = [];

  for (let i = 0; i < receipts.length; i++) {
    const cumulative = BigInt(receipts[i].cumulative_amount);
    if (cumulative > onChainSettled[i]) {
      toSettle.push(receipts[i]);
    }
  }

  if (toSettle.length === 0) {
    console.log("[settler] All receipts already settled on-chain. Nothing to do.");
    return;
  }

  // -------------------------------------------------------------------------
  // 4. Sort: no-referrer receipts first (so paidTo[referrer][creator] is set
  //    before any receipt that relies on it for referral eligibility).
  // -------------------------------------------------------------------------
  toSettle.sort((a, b) => {
    const aIsZero = isNoReferrer(a) ? 0 : 1;
    const bIsZero = isNoReferrer(b) ? 0 : 1;
    return aIsZero - bIsZero;
  });

  console.log(`[settler] ${toSettle.length} receipt(s) need settlement.`);
  for (const r of toSettle) {
    const ref = normaliseReferrer(r.referrer);
    console.log(
      `  viewer=${r.viewer}  creator=${r.creator}  referrer=${ref}  cumulative=${r.cumulative_amount}`
    );
  }

  // -------------------------------------------------------------------------
  // 5. Call settleBatch on the contract (chunked at MAX_BATCH=100)
  // -------------------------------------------------------------------------
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const walletClient = createWalletClient({
    account,
    chain: arcChain,
    transport: http(ARC_RPC),
  });

  const CHUNK = 100;
  for (let offset = 0; offset < toSettle.length; offset += CHUNK) {
    const chunk = toSettle.slice(offset, offset + CHUNK);

    const rs = chunk.map((r) => ({
      viewer:           getAddress(r.viewer),
      creator:          getAddress(r.creator),
      referrer:         normaliseReferrer(r.referrer),
      cumulativeAmount: BigInt(r.cumulative_amount),
      deadline:         BigInt(r.deadline),
    }));

    const sigs = chunk.map((r) => r.signature as `0x${string}`);

    console.log(
      `[settler] Calling settleBatch with ${chunk.length} receipt(s) (chunk ${Math.floor(offset / CHUNK) + 1})...`
    );

    const txHash = await walletClient.writeContract({
      address: CONTRACT_ADDRESS,
      abi: PPW_ABI,
      functionName: "settleBatch",
      args: [rs, sigs],
    });

    console.log(`[settler] settleBatch tx hash: ${txHash}`);
    const explorerBase =
      ARC_CHAIN_ID === 5042
        ? "https://explorer.arc.io"
        : "https://explorer.testnet.arc.io";
    console.log(`[settler] Explorer: ${explorerBase}/tx/${txHash}`);

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status === "reverted") {
      console.error(`[settler] WARNING: transaction ${txHash} REVERTED`);
    } else {
      console.log(`[settler] Confirmed in block ${receipt.blockNumber}`);
    }
  }

  console.log(`[settler] Settle run complete at ${new Date().toISOString()}`);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const isCron = process.argv.includes("--cron");

if (isCron) {
  // Requires: bun add node-cron
  const startCron = async (): Promise<void> => {
    const { default: cron } = await import("node-cron") as {
      default: { schedule: (expr: string, fn: () => void) => void };
    };
    console.log("[settler] Starting hourly cron scheduler...");
    cron.schedule("0 * * * *", () => {
      runSettle().catch((err: unknown) => {
        console.error("[settler] Error during scheduled run:", err);
      });
    });
    runSettle().catch((err: unknown) => {
      console.error("[settler] Error during initial run:", err);
    });
  };
  startCron().catch((err: unknown) => {
    console.error("[settler] Failed to start cron:", err);
    process.exit(1);
  });
} else {
  runSettle()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[settler] Fatal error:", err);
      process.exit(1);
    });
}
