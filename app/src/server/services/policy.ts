import type { BuyerPolicy } from "@/contracts";
import { notFound } from "../errors";
import { getRepo } from "../repo";
import { DEFAULT_POLICY_ID } from "../seed/constants";

export async function getPolicy(id = DEFAULT_POLICY_ID): Promise<BuyerPolicy> {
  const p = await getRepo().policies.get(id);
  if (!p) throw notFound("policy", id);
  return p;
}

export async function updatePolicy(policy: BuyerPolicy): Promise<BuyerPolicy> {
  return getRepo().policies.put(policy);
}
