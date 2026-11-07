import type { IntegrationStatus } from "@/contracts";
import { checkSources } from "@/server/checks";
import { integrationStatus } from "@/server/env";
import { handle } from "@/server/http";

/** Live store data: never prerender or cache. */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(req, async (): Promise<IntegrationStatus> => integrationStatus(checkSources()));
}
