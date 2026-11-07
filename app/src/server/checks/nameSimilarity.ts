// Fuzzy name match against already-enrolled suppliers (impersonation, flag 7).
// The registry is our own store, so there is no external data source; in Supabase mode the
// same comparison can run in Postgres with pg_trgm (see supabase/schema.sql similar_suppliers()).
import { env } from "../env";
import { NEAR_COPY_THRESHOLD, nameSimilarity, normalizeDomain } from "./names";
import { result, type CheckAdapter, type CheckContext } from "./types";

export function evaluateNameSimilarity(ctx: CheckContext, source: "fixture" | "live") {
  const { supplier, knownSuppliers } = ctx;
  const candidates = knownSuppliers
    .filter((k) => k.id !== supplier.id && normalizeDomain(k.domain) !== normalizeDomain(supplier.domain))
    .map((k) => ({ supplierId: k.id, legalName: k.legalName, domain: k.domain, similarity: nameSimilarity(supplier.legalName, k.legalName) }))
    .sort((a, b) => b.similarity - a.similarity);
  const best = candidates[0];
  const nearCopy = Boolean(best && best.similarity >= NEAR_COPY_THRESHOLD);
  return result("name_similarity", source, nearCopy ? "flag" : "pass", {
    comparedAgainst: candidates.length,
    threshold: NEAR_COPY_THRESHOLD,
    bestMatch: best ? { ...best, similarity: Math.round(best.similarity * 1000) / 1000 } : null,
  }, ctx.now);
}

export const nameSimilarityAdapter: CheckAdapter = {
  kind: "name_similarity",
  get source() {
    return env.supabase() ? ("live" as const) : ("fixture" as const);
  },
  async run(ctx) {
    return evaluateNameSimilarity(ctx, this.source);
  },
};
