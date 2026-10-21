import { isMock } from "@/lib/env";
import * as mock from "@/lib/mock/contract";
import { listVideos } from "@/lib/server/db";
import { error, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

// Mock-mode chain endpoint: the browser's contract calls land here. 404 outside mock mode.
export async function POST(req: Request) {
  if (!isMock) return error("Not found", 404);
  await listVideos(); // make sure the seed videos are registered
  const { op, fn, args = [], from } = (await req.json()) as { op: string; fn: string; args?: unknown[]; from?: string };
  try {
    if (op === "read") return json({ result: mock.read(fn, args) });
    if (op === "write") {
      if (!from) return error("Missing from");
      return json({ hash: mock.write(fn, args, from) });
    }
    if (op === "fastForwardWithdrawal" && from) {
      mock.fastForwardWithdrawal(from);
      return json({ ok: true });
    }
    return error("Unknown op");
  } catch (e) {
    return json({ revert: e instanceof Error ? e.message : String(e) }, { status: 409 });
  }
}
