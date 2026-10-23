import { getIndexEntry } from "@/lib/server/content-db";
import { error, json } from "@/lib/server/http";
import { workerAuthorized } from "@/lib/server/review";

export const dynamic = "force-dynamic";

/** GET (worker) -> one index entry's fingerprints and transcript. Entries never change, so the worker caches them. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  if (!workerAuthorized(req)) return error("Unauthorized", 401);
  const entry = await getIndexEntry(decodeURIComponent(params.id));
  if (!entry) return error("Not found", 404);
  return json({ entry: { ...entry, segments: undefined } });
}
