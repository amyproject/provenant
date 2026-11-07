import type { BuyerPolicy, PolicyResponse } from "@/contracts";
import { handle, readJson } from "@/server/http";
import { DEFAULT_POLICY_ID } from "@/server/seed/constants";
import { getPolicy, updatePolicy } from "@/server/services/policy";
import { BuyerPolicySchema } from "@/server/validation";

/** Live store data: never prerender or cache. */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(req, async (): Promise<PolicyResponse> => getPolicy());
}

/** Replace the buyer policy. Single-policy demo: always stored as the default policy. */
export async function PUT(req: Request) {
  return handle(req, async (): Promise<PolicyResponse> => {
    const body = await readJson(req, BuyerPolicySchema);
    return updatePolicy({ ...(body as BuyerPolicy), id: DEFAULT_POLICY_ID });
  });
}
