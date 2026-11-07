import type { AgentCase } from "@/contracts";
import { handle } from "@/server/http";
import { getRepo } from "@/server/repo";

/** Live store data: never prerender or cache. */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(req, async (): Promise<AgentCase[]> => (await getRepo().cases.list()).reverse());
}
