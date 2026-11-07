// USPS CMRA / virtual-office check (Google Address Validation API returns USPS dpvCmra).
import cmraFixture from "../../../data/fixtures/cmra.json";
import { errorMessage, fetchJson } from "./http";
import { normalizeAddressKey } from "./names";
import { result, type CheckAdapter, type CheckContext } from "./types";

interface UspsData {
  dpvCmra?: string;
  dpvConfirmation?: string;
  rdi?: string;
  note?: string;
}

const FIXTURE = cmraFixture.addresses as Record<string, UspsData>;

/** Private-mailbox markers USPS uses for CMRA addresses ("PMB 12", "#4417", "PO Box"). */
const MAILBOX_PATTERN = /\b(pmb|p\.?\s?o\.?\s?box|private mailbox)\b|#\s*\d+/i;

export function evaluateCmra(ctx: CheckContext, usps: UspsData | null, source: "fixture" | "live") {
  const { address } = ctx.supplier;
  if (address.country !== "US") {
    return result("address_cmra", source, "skip", { reason: "USPS CMRA data only covers US addresses." }, ctx.now);
  }
  const heuristic = MAILBOX_PATTERN.test(address.line1);
  const cmra = usps?.dpvCmra === "Y" || (!usps && heuristic);
  return result("address_cmra", source, cmra ? "flag" : "pass", {
    address: `${address.line1}, ${address.city}, ${address.state} ${address.zip}`,
    dpvCmra: usps?.dpvCmra ?? (heuristic ? "Y" : "N"),
    rdi: usps?.rdi,
    basis: usps ? "USPS CASS (dpvCmra)" : "address pattern only (no USPS record)",
    ...(usps?.note ? { note: usps.note } : {}),
  }, ctx.now);
}

export const cmraFixtureAdapter: CheckAdapter = {
  kind: "address_cmra",
  source: "fixture",
  async run(ctx) {
    const { line1, zip } = ctx.supplier.address;
    return evaluateCmra(ctx, FIXTURE[normalizeAddressKey(line1, zip)] ?? null, "fixture");
  },
};

interface AddressValidationResponse {
  result?: { uspsData?: UspsData };
}

/** Live: Google Address Validation API with USPS CASS enabled. */
export const cmraLiveAdapter: CheckAdapter = {
  kind: "address_cmra",
  source: "live",
  async run(ctx) {
    const { address } = ctx.supplier;
    try {
      const data = await fetchJson<AddressValidationResponse>(
        `https://addressvalidation.googleapis.com/v1:validateAddress?key=${process.env.GOOGLE_MAPS_API_KEY ?? ""}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            address: { regionCode: address.country, addressLines: [address.line1, `${address.city}, ${address.state} ${address.zip}`] },
            enableUspsCass: true,
          }),
        },
      );
      return evaluateCmra(ctx, data.result?.uspsData ?? null, "live");
    } catch (err) {
      return result("address_cmra", "live", "error", { error: errorMessage(err) }, ctx.now);
    }
  },
};
