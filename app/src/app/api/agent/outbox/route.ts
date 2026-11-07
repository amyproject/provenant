import type { AgentOutboxResponse } from "@/contracts";
import { handle } from "@/server/http";
import { getRepo } from "@/server/repo";

/** Live store data: never prerender or cache. */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(req, async (): Promise<AgentOutboxResponse> => (await getRepo().outbox.list()).reverse());
}
