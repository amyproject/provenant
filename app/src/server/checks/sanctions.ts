// Consolidated Screening List (sanctions, export denial, debarment).
import cslFixture from "../../../data/fixtures/csl.json";
import { errorMessage, fetchJson } from "./http";
import { nameSimilarity } from "./names";
import { result, type CheckAdapter, type CheckContext } from "./types";

export const SANCTIONS_MATCH_THRESHOLD = 0.9;

interface CslEntry {
  name: string;
  alt_names: string[];
  source: string;
  country?: string;
}

/** Pure: fuzzy-screen a name against list entries. */
export function screenName(name: string, entries: CslEntry[]) {
  return entries
    .map((e) => ({
      name: e.name,
      source: e.source,
      country: e.country,
      score: Math.max(...[e.name, ...e.alt_names].map((n) => nameSimilarity(name, n))),
    }))
    .filter((m) => m.score >= SANCTIONS_MATCH_THRESHOLD)
    .sort((a, b) => b.score - a.score);
}

function evaluate(ctx: CheckContext, entries: CslEntry[], source: "fixture" | "live") {
  const matches = screenName(ctx.supplier.legalName, entries);
  return result("sanctions", source, matches.length ? "flag" : "pass", {
    screenedName: ctx.supplier.legalName,
    listEntriesScreened: entries.length,
    matches,
  }, ctx.now);
}

export const sanctionsFixtureAdapter: CheckAdapter = {
  kind: "sanctions",
  source: "fixture",
  async run(ctx) {
    return evaluate(ctx, cslFixture.entries, "fixture");
  },
};

interface CslDownload {
  results: { name: string; alt_names?: string[] | null; source: string; country?: string | null }[];
}

const g = globalThis as unknown as { __provenantCsl?: { at: number; entries: CslEntry[] } };
const CSL_URL = "https://data.trade.gov/downloadable_consolidated_screening_list/v1/consolidated.json";

/** Live (LIVE_PUBLIC_LOOKUPS=1): the free CSL JSON download, cached in memory for 12 hours. */
export const sanctionsLiveAdapter: CheckAdapter = {
  kind: "sanctions",
  source: "live",
  async run(ctx) {
    try {
      if (!g.__provenantCsl || Date.now() - g.__provenantCsl.at > 12 * 3_600_000) {
        const data = await fetchJson<CslDownload>(CSL_URL, {}, 30_000);
        g.__provenantCsl = {
          at: Date.now(),
          entries: data.results.map((r) => ({ name: r.name, alt_names: r.alt_names ?? [], source: r.source, country: r.country ?? undefined })),
        };
      }
      return evaluate(ctx, g.__provenantCsl.entries, "live");
    } catch (err) {
      return result("sanctions", "live", "error", { error: errorMessage(err) }, ctx.now);
    }
  },
};
