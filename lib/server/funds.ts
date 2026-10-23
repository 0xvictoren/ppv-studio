import "server-only";
import { readPpw } from "./chain";
import { listReceipts } from "./db";

/** A viewer's PayPerWatch balance minus everything they've signed for that isn't settled yet. */
export async function spendableBalance(viewer: string): Promise<bigint> {
  const [balance, rows] = await Promise.all([readPpw<bigint>("balanceOf", [viewer]), listReceipts({ viewer })]);
  const owed = await Promise.all(
    rows.map(async (r) => {
      const settled = await readPpw<bigint>("settled", [r.viewer, r.creator, r.referrer]);
      const pending = BigInt(r.cumulative_amount) - settled;
      return pending > 0n ? pending : 0n;
    }),
  );
  return balance - owed.reduce((a, b) => a + b, 0n);
}
