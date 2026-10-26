import { agentInfoText } from "@/lib/server/agent-info";

export const dynamic = "force-static";

// For agents pointed at the site itself: what PayPerWatch sells and how to pay for it.
export function GET() {
  return new Response(agentInfoText(), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } });
}
