// Website age via RDAP (free, public protocol).
import rdapFixture from "../../../data/fixtures/rdap.json";
import { daysBetween } from "../util/ids";
import { errorMessage, fetchJson } from "./http";
import { normalizeDomain } from "./names";
import { result, type CheckAdapter, type CheckContext } from "./types";

/** A website younger than this counts as "recently created" (flag 7). */
export const YOUNG_DOMAIN_DAYS = 180;

const FIXTURE = rdapFixture.domains as Record<string, { registration: string; registrar?: string; privacyProxy?: boolean }>;

export function evaluateDomainAge(
  ctx: CheckContext,
  registration: string | null,
  extra: Record<string, unknown>,
  source: "fixture" | "live",
) {
  const domain = normalizeDomain(ctx.supplier.domain);
  if (!registration) {
    return result("domain_age", source, "skip", { domain, reason: "No RDAP registration event found." }, ctx.now);
  }
  const ageDays = daysBetween(registration, ctx.now);
  return result("domain_age", source, ageDays < YOUNG_DOMAIN_DAYS ? "flag" : "pass", {
    domain,
    registeredAt: registration,
    ageDays,
    thresholdDays: YOUNG_DOMAIN_DAYS,
    ...extra,
  }, ctx.now);
}

export const domainFixtureAdapter: CheckAdapter = {
  kind: "domain_age",
  source: "fixture",
  async run(ctx) {
    const rec = FIXTURE[normalizeDomain(ctx.supplier.domain)];
    return evaluateDomainAge(ctx, rec?.registration ?? null, rec ? { registrar: rec.registrar, privacyProxy: rec.privacyProxy ?? false } : {}, "fixture");
  },
};

interface RdapResponse {
  events?: { eventAction: string; eventDate: string }[];
}

export const domainLiveAdapter: CheckAdapter = {
  kind: "domain_age",
  source: "live",
  async run(ctx) {
    try {
      const data = await fetchJson<RdapResponse>(`https://rdap.org/domain/${encodeURIComponent(normalizeDomain(ctx.supplier.domain))}`, {
        headers: { accept: "application/rdap+json" },
      });
      const reg = data.events?.find((e) => e.eventAction === "registration")?.eventDate ?? null;
      return evaluateDomainAge(ctx, reg, {}, "live");
    } catch (err) {
      return result("domain_age", "live", "error", { error: errorMessage(err) }, ctx.now);
    }
  },
};
