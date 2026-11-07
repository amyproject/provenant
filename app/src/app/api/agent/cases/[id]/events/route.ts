import type { AgentEventsResponse } from "@/contracts";
import { listEvents } from "@/server/agent/machine";
import { handle } from "@/server/http";

/** Live store data: never prerender or cache. */
export const dynamic = "force-dynamic";

/** Case timeline in order; ?after=<eventId> returns only newer events (UI polling). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(req, async (): Promise<AgentEventsResponse> => {
    const after = new URL(req.url).searchParams.get("after");
    return listEvents((await params).id, after);
  });
}
