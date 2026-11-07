import type { AgentEventsResponse } from "@/contracts";
import { listAllEvents } from "@/server/agent/machine";
import { handle } from "@/server/http";

/** Live store data: never prerender or cache. */
export const dynamic = "force-dynamic";

/** Events across all cases, oldest to newest: ?after=<eventId>&limit=<n> (default 50, max 1000). */
export async function GET(req: Request) {
  return handle(req, async (): Promise<AgentEventsResponse> => {
    const q = new URL(req.url).searchParams;
    return listAllEvents(q.get("after"), Number(q.get("limit") ?? 50));
  });
}
