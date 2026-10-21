import { json } from "@/lib/server/http";
import { sessionAddress } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export async function GET() {
  return json({ address: await sessionAddress() });
}
