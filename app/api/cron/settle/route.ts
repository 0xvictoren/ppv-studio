import { isMock } from "@/lib/env";
import { ONE_USDC } from "@/lib/money";
import { withdrawPlatformFees } from "@/lib/server/chain";
import { error, json } from "@/lib/server/http";
import { runSettlement } from "@/lib/server/settle";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Hourly settlement. Vercel Cron calls GET with `Authorization: Bearer $CRON_SECRET`;
// other schedulers can send `x-cron-secret: $CRON_SECRET`. In mock mode with no secret
// configured, the "Run settlement now" demo button may call it too.
function authorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return isMock;
  return req.headers.get("authorization") === `Bearer ${secret}` || req.headers.get("x-cron-secret") === secret;
}

async function handle(req: Request) {
  if (!authorized(req)) return error("Unauthorized", 401);
  const result = await runSettlement();
  // Fees accrue in the contract (v4); sweep them to the fee recipient once there's at least $1.
  const feesTx = await withdrawPlatformFees(ONE_USDC).catch((e) => {
    console.error("[settle] fee withdrawal failed:", e instanceof Error ? e.message.split("\n")[0] : e);
    return null;
  });
  return json({ ...result, feesTx }, { status: result.status === "error" ? 500 : 200 });
}

export const GET = handle;
export const POST = handle;
