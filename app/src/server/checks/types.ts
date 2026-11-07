import type { IdentityCheckKind, IdentityCheckResult, Supplier } from "@/contracts";

export type SupplierIdentity = Pick<
  Supplier,
  "id" | "legalName" | "domain" | "address" | "uei" | "cageCode" | "ein" | "claimedUsProduction" | "createdAt"
>;

export interface CheckContext {
  supplier: SupplierIdentity;
  /** Previously enrolled suppliers to compare names against (excluding the subject). */
  knownSuppliers: Supplier[];
  now: string;
}

export interface CheckAdapter {
  kind: IdentityCheckKind;
  source: "fixture" | "live";
  run(ctx: CheckContext): Promise<IdentityCheckResult>;
}

export function result(
  kind: IdentityCheckKind,
  source: "fixture" | "live",
  status: IdentityCheckResult["status"],
  evidence: Record<string, unknown>,
  now: string,
): IdentityCheckResult {
  return { kind, status, source, evidence, checkedAt: now };
}
