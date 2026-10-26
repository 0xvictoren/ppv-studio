import { agentInfo } from "@/lib/server/agent-info";
import { json } from "@/lib/server/http";

export const dynamic = "force-static";

/** GET -> machine-readable description of the agent API: endpoints, pricing and payment. */
export function GET() {
  return json(agentInfo());
}
