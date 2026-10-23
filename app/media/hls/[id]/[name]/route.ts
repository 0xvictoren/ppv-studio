import { readFile } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "@/lib/server/db";

export const dynamic = "force-dynamic";

/** Encrypted HLS segments for local storage. Public: without the per-segment keys they're noise. */
export async function GET(_req: Request, props: { params: Promise<{ id: string; name: string }> }) {
  const { id, name } = await props.params;
  if (!/^[A-Za-z0-9._-]{1,300}$/.test(id) || id.includes("..") || !/^seg\d{5}\.ts$/.test(name)) return new Response("Not found", { status: 404 });
  const body = await readFile(path.join(DATA_DIR, "hls", id, name)).catch(() => null);
  if (!body) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(body), { headers: { "content-type": "video/mp2t", "cache-control": "public, max-age=31536000, immutable" } });
}
