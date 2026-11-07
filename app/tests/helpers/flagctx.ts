// Hand-built FlagContext for pure rule tests. Every rule is a function of this object only.
import type {
  BuyerPolicy,
  EvidenceDocument,
  IdentityCheckResult,
  PartPassport,
  PurchaseOrder,
  Supplier,
} from "@/contracts";
import type { FlagContext } from "@/server/flags";

export const NOW = "2026-11-07T12:00:00.000Z";

export const policy = (over: Partial<BuyerPolicy> = {}): BuyerPolicy => ({
  id: "pol_qa",
  name: "QA policy",
  domesticContentThreshold: 0.65,
  restrictedCountries: ["CN", "RU"],
  tierFlags: {
    low: ["F01_SIGNATURE_INVALID", "F06_VIRTUAL_OFFICE", "F07_IMPERSONATOR_NAME"],
    medium: ["F01_SIGNATURE_INVALID", "F06_VIRTUAL_OFFICE", "F07_IMPERSONATOR_NAME", "F03_REUSED_TEST_CERT"],
    high: [
      "F01_SIGNATURE_INVALID",
      "F02_TAG_CLONE",
      "F03_REUSED_TEST_CERT",
      "F04_DOC_METADATA_MISMATCH",
      "F05_IMPORTED_FINISHED_GOODS",
      "F06_VIRTUAL_OFFICE",
      "F07_IMPERSONATOR_NAME",
      "F08_PRICE_LEADTIME_OUTLIER",
      "F09_BANK_CHANGE_NO_REAUTH",
      "F10_UNDISCLOSED_SUBTIER_CHANGE",
    ],
  },
  quarantineAtFlagCount: 1,
  blockAtFlagCount: 2,
  tierRequiredEvidence: { low: [], medium: ["facility_attestation"], high: ["facility_attestation", "test_report"] },
  rechaseIntervalSec: 30,
  maxChaseAttempts: 3,
  ...over,
});

export const supplier = (over: Partial<Supplier> = {}): Supplier => ({
  id: "sup_x",
  legalName: "Xylo Motion Inc.",
  domain: "xylomotion.com",
  address: { line1: "500 Factory Rd", city: "Akron", state: "OH", zip: "44301", country: "US" },
  contactEmail: "ops@xylomotion.com",
  claimedUsProduction: true,
  status: "enrolled",
  createdAt: "2020-01-01T00:00:00.000Z",
  ...over,
});

export const passport = (over: Partial<PartPassport> = {}): PartPassport => ({
  id: "pp_x1",
  version: 1,
  supplierId: "sup_x",
  facility: supplier().address,
  serialOrBatch: "LOT-X1",
  model: "XM-1",
  spec: "servo",
  components: [
    { name: "Housing", supplierName: "Ohio Castings", countryOfOrigin: "US", costUsd: 70 },
    { name: "Reducer", supplierName: "Kyoto Gears", countryOfOrigin: "JP", costUsd: 30 },
  ],
  totalCostUsd: 100,
  domesticContentRatio: 0.7,
  testCertificates: [{ certNumber: "TC-X-1", issuer: "Acme Labs", fileSha256: "1".repeat(64) }],
  issuedAt: "2026-06-01T00:00:00.000Z",
  expiresAt: "2027-06-01T00:00:00.000Z",
  statusIndex: 0,
  revoked: false,
  jwt: "h.p.s",
  ...over,
});

export const po = (over: Partial<PurchaseOrder> = {}): PurchaseOrder => ({
  id: "po_x",
  buyerPolicyId: "pol_qa",
  supplierId: "sup_x",
  passportIds: ["pp_x1"],
  riskTier: "high",
  amountUsd: 10000,
  decision: "pending",
  decisionReasons: [],
  createdAt: NOW,
  ...over,
});

export const check = (
  kind: IdentityCheckResult["kind"],
  status: IdentityCheckResult["status"],
  evidence: Record<string, unknown> = {},
): IdentityCheckResult => ({ kind, status, source: "fixture", evidence, checkedAt: NOW });

export const doc = (over: Partial<EvidenceDocument> = {}): EvidenceDocument => ({
  id: "doc_x",
  supplierId: "sup_x",
  kind: "test_report",
  filename: "report.pdf",
  sha256: "1".repeat(64),
  extracted: {},
  metadata: {},
  receivedVia: "seed",
  receivedAt: NOW,
  ...over,
});

/** A clean, passing context: one valid passport, normal address, no oddities. */
export function ctx(over: Partial<FlagContext> = {}): FlagContext {
  const p = passport();
  const s = supplier();
  return {
    now: NOW,
    po: po(),
    supplier: s,
    policy: policy(),
    passports: [p],
    verifications: { [p.id]: { valid: true, revoked: false } },
    previousVersions: {},
    identityChecks: [
      check("address_cmra", "pass", { address: "500 Factory Rd, Akron OH", dpvCmra: "N" }),
      check("name_similarity", "pass", { bestMatch: null }),
      check("domain_age", "pass", { ageDays: 4000 }),
      check("sam_registration", "pass", { registered: true }),
      check("shipping_history", "pass", { shipments: [] }),
    ],
    documents: [doc()],
    allPassports: [p],
    allDocuments: [doc()],
    allSuppliers: [s],
    issuerSamples: { "Acme Labs": { producers: ["AcmeLIMS 4.2"], templateIds: ["ACME-TR-v3"], certNumberPattern: "^TC-" } },
    priceBaselines: [
      { category: "servo_actuator", models: ["XM-1"], unitPriceMeanUsd: 1000, unitPriceStdUsd: 100, minFeasibleLeadTimeDays: 14, sampleSize: 40 },
    ],
    priceZThreshold: 3,
    tagChallenges: {},
    bankChanges: [],
    ...over,
  };
}
