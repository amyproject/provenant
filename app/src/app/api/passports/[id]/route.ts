import type { PartPassport } from "@/contracts";
import { handle } from "@/server/http";
import { getPassport } from "@/server/services/passports";

/** Live store data: never prerender or cache. */
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(req, async (): Promise<PartPassport> => getPassport((await params).id));
}
