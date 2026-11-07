import type { IntegrationStatus } from "@/contracts";
import { checkSources } from "@/server/checks";
import { signingKeysMode } from "@/server/crypto/keys";
import { integrationStatus } from "@/server/env";
import { handle } from "@/server/http";
import { getRepo } from "@/server/repo";

/** Live store data: never prerender or cache. */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(req, async (): Promise<IntegrationStatus> => ({ ...integrationStatus(checkSources(), signingKeysMode()), storage: getRepo().kind }));
}
