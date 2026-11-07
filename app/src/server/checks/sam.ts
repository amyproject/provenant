// SAM.gov entity registration (legal identity, UEI/CAGE, registration dates, exclusions).
import samFixture from "../../../data/fixtures/sam.json";
import { daysBetween } from "../util/ids";
import { errorMessage, fetchJson } from "./http";
import { NEAR_COPY_THRESHOLD, nameSimilarity } from "./names";
import { result, type CheckAdapter, type CheckContext } from "./types";

interface SamEntity {
  ueiSAM: string;
  cageCode?: string;
  legalBusinessName: string;
  registrationStatus: string;
  registrationDate: string;
  activationDate?: string;
  registrationExpirationDate?: string;
  entityStartDate?: string;
  exclusionStatusFlag?: string;
}

const FIXTURE = samFixture.entities as Record<string, SamEntity>;

/** Pure evaluation shared by fixture and live adapters. */
export function evaluateSam(ctx: CheckContext, entity: SamEntity | null, source: "fixture" | "live") {
  const { supplier, now } = ctx;
  if (!entity) {
    if (!supplier.uei) {
      return result("sam_registration", source, "skip", {
        registered: false,
        reason: "No UEI provided and no SAM.gov registration found for the legal name (no federal filing history).",
      }, now);
    }
    return result("sam_registration", source, "flag", {
      registered: false,
      uei: supplier.uei,
      reason: `UEI ${supplier.uei} is not registered in SAM.gov.`,
    }, now);
  }
  const similarity = nameSimilarity(entity.legalBusinessName, supplier.legalName);
  const active = entity.registrationStatus.toLowerCase() === "active";
  const excluded = entity.exclusionStatusFlag === "Y";
  const issues = [
    !active && `registration status is ${entity.registrationStatus}`,
    excluded && "entity has an active exclusion (debarment)",
    similarity < NEAR_COPY_THRESHOLD && `SAM legal name "${entity.legalBusinessName}" does not match "${supplier.legalName}"`,
    supplier.cageCode && entity.cageCode && supplier.cageCode !== entity.cageCode && `CAGE ${supplier.cageCode} != ${entity.cageCode}`,
  ].filter(Boolean) as string[];
  return result("sam_registration", source, issues.length ? "flag" : "pass", {
    registered: true,
    uei: entity.ueiSAM,
    cageCode: entity.cageCode,
    legalBusinessName: entity.legalBusinessName,
    registrationStatus: entity.registrationStatus,
    registrationDate: entity.registrationDate,
    registrationAgeDays: daysBetween(entity.registrationDate, now),
    expirationDate: entity.registrationExpirationDate,
    exclusions: excluded,
    issues,
  }, now);
}

export const samFixtureAdapter: CheckAdapter = {
  kind: "sam_registration",
  source: "fixture",
  async run(ctx) {
    const entity = ctx.supplier.uei ? FIXTURE[ctx.supplier.uei] ?? null : null;
    return evaluateSam(ctx, entity, "fixture");
  },
};

interface SamApiResponse {
  totalRecords: number;
  entityData?: {
    entityRegistration: SamEntity;
    coreData?: { entityInformation?: { entityStartDate?: string } };
  }[];
}

/** Live: SAM.gov Entity Management API v3. Non-federal keys are limited to ~10 req/day — cache upstream. */
export const samLiveAdapter: CheckAdapter = {
  kind: "sam_registration",
  source: "live",
  async run(ctx) {
    try {
      const q = new URLSearchParams({ api_key: process.env.SAM_GOV_API_KEY ?? "" });
      if (ctx.supplier.uei) q.set("ueiSAM", ctx.supplier.uei);
      else q.set("legalBusinessName", ctx.supplier.legalName);
      const data = await fetchJson<SamApiResponse>(`https://api.sam.gov/entity-information/v3/entities?${q}`);
      const row = data.entityData?.[0];
      const entity = row
        ? { ...row.entityRegistration, entityStartDate: row.coreData?.entityInformation?.entityStartDate }
        : null;
      return evaluateSam(ctx, entity, "live");
    } catch (err) {
      return result("sam_registration", "live", "error", { error: errorMessage(err) }, ctx.now);
    }
  },
};
