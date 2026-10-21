import { getEvents } from "@/lib/server/events";
import { error, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET ?name=Settled,Deposited&viewer=&creator=&videoId= */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const name = url.searchParams.get("name")?.split(",").filter(Boolean);
  try {
    const events = await getEvents({
      name,
      viewer: url.searchParams.get("viewer") ?? undefined,
      creator: url.searchParams.get("creator") ?? undefined,
      videoId: url.searchParams.get("videoId") ?? undefined,
    });
    return json({ events: events.slice().reverse() });
  } catch (e) {
    return error(`Couldn't read contract events: ${e instanceof Error ? e.message : e}`, 502);
  }
}
