// Loop 1 identity checks. Each check has a fixture adapter (default, no network) and a live adapter
// enabled by its env key. Results are tagged with the source they ran against.
import type { DataSource, IdentityCheckKind, IdentityCheckResult } from "@/contracts";
import { env } from "../env";
import { cmraFixtureAdapter, cmraLiveAdapter } from "./address";
import { domainFixtureAdapter, domainLiveAdapter } from "./domain";
import { nameSimilarityAdapter } from "./nameSimilarity";
import { samFixtureAdapter, samLiveAdapter } from "./sam";
import { sanctionsFixtureAdapter, sanctionsLiveAdapter } from "./sanctions";
import { shippingFixtureAdapter, shippingLiveAdapter } from "./shipping";
import type { CheckAdapter, CheckContext } from "./types";

export type { CheckContext, SupplierIdentity } from "./types";
export { nameSimilarity, normalizeCompanyName, NEAR_COPY_THRESHOLD } from "./names";
export { YOUNG_DOMAIN_DAYS } from "./domain";

export function checkAdapters(): CheckAdapter[] {
  return [
    env.samLive() ? samLiveAdapter : samFixtureAdapter,
    env.publicLookups() ? sanctionsLiveAdapter : sanctionsFixtureAdapter,
    env.addressLive() ? cmraLiveAdapter : cmraFixtureAdapter,
    env.publicLookups() ? domainLiveAdapter : domainFixtureAdapter,
    nameSimilarityAdapter,
    env.importYetiLive() ? shippingLiveAdapter : shippingFixtureAdapter,
  ];
}

/** Data source each identity check currently runs against (for IntegrationStatus.checkSources). */
export function checkSources(): Record<IdentityCheckKind, DataSource> {
  return Object.fromEntries(checkAdapters().map((a) => [a.kind, a.source])) as Record<IdentityCheckKind, DataSource>;
}

export async function runIdentityChecks(ctx: CheckContext): Promise<IdentityCheckResult[]> {
  return Promise.all(checkAdapters().map((a) => a.run(ctx)));
}

/** Enrollment gate: a credential is issued only if no check raised a flag. */
export const passesEnrollment = (checks: IdentityCheckResult[]) => !checks.some((c) => c.status === "flag");
