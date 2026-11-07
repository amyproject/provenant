// Shipping history via ImportYeti bill-of-lading data (flag 5: claims US production but imports finished goods).
import importYetiFixture from "../../../data/fixtures/importyeti.json";
import { errorMessage, fetchJson } from "./http";
import { strictCompanyKey } from "./names";
import { result, type CheckAdapter, type CheckContext } from "./types";

export interface Shipment {
  date: string;
  shipper: string;
  originCountry: string;
  hsCode: string;
  description: string;
  finishedGoods: boolean;
}

const FIXTURE = importYetiFixture.companies as Record<string, { shipments: Shipment[] }>;
const CAVEAT = "ImportYeti covers sea freight only: no record is not proof of domestic production.";

export function evaluateShipping(ctx: CheckContext, shipments: Shipment[] | null, source: "fixture" | "live") {
  if (!shipments) {
    return result("shipping_history", source, "skip", { reason: "No bill-of-lading record for this company.", caveat: CAVEAT }, ctx.now);
  }
  const finished = shipments.filter((s) => s.finishedGoods);
  const contradicts = ctx.supplier.claimedUsProduction && finished.length > 0;
  return result("shipping_history", source, contradicts ? "flag" : "pass", {
    shipmentCount: shipments.length,
    finishedGoodsShipments: finished.length,
    origins: [...new Set(shipments.map((s) => s.originCountry))],
    shipments,
    caveat: CAVEAT,
  }, ctx.now);
}

export const shippingFixtureAdapter: CheckAdapter = {
  kind: "shipping_history",
  source: "fixture",
  async run(ctx) {
    return evaluateShipping(ctx, FIXTURE[strictCompanyKey(ctx.supplier.legalName)]?.shipments ?? null, "fixture");
  },
};

/**
 * Live: ImportYeti API (paid credits).
 * TODO(backend): endpoint path and response shape are unverified against docs.importyeti.com —
 * confirm before relying on this adapter; any mismatch surfaces as status "error", never a pass.
 */
export const shippingLiveAdapter: CheckAdapter = {
  kind: "shipping_history",
  source: "live",
  async run(ctx) {
    try {
      const q = new URLSearchParams({ name: ctx.supplier.legalName });
      const data = await fetchJson<{ shipments?: Partial<Shipment>[] }>(`https://data.importyeti.com/v1.0/company/shipments?${q}`, {
        headers: { IYApiKey: process.env.IMPORTYETI_API_KEY ?? "" },
      });
      if (!Array.isArray(data.shipments)) throw new Error("unexpected ImportYeti response shape (no shipments array)");
      const shipments = data.shipments.map((s) => ({
        date: String(s.date ?? ""),
        shipper: String(s.shipper ?? ""),
        originCountry: String(s.originCountry ?? ""),
        hsCode: String(s.hsCode ?? ""),
        description: String(s.description ?? ""),
        // Chapters 84/85 assemblies under the same HS heading as the buyer's part are treated as finished goods.
        finishedGoods: Boolean(s.finishedGoods),
      }));
      return evaluateShipping(ctx, shipments, "live");
    } catch (err) {
      return result("shipping_history", "live", "error", { error: errorMessage(err) }, ctx.now);
    }
  },
};
