// In-browser mock backend used when NEXT_PUBLIC_USE_MOCKS=1.
// Mirrors the demo: fictional supplier A (approved), B (quarantined by F10), C (blocked by F03/F06/F07).
// The agent is simulated as a scripted state machine so the autopilot / timeline UI behaves like the
// real thing: POST /api/agent/tick advances every open case one step.
// All companies, people, addresses and identifiers below are fictional.
import { distance } from "fastest-levenshtein";
import type {
  AgentCase,
  AgentEvent,
  AgentState,
  AutopilotStatus,
  BuyerPolicy,
  Decision,
  DemoRunResponse,
  EvidenceDocument,
  EvidenceGap,
  FlagId,
  FlagResult,
  IdentityCheckResult,
  IntegrationStatus,
  OutboundMessage,
  PartPassport,
  PassportComponent,
  PurchaseOrder,
  PurchaseOrderDetail,
  RiskTier,
  Supplier,
  VerifyResult,
} from "@/contracts";
import { DEMO, DEMO_POLICY_ID } from "@/contracts";
import type { Api } from "./api";
import { ApiClientError } from "./errors";

// ---------------------------------------------------------------- helpers

const MIN = 60_000;
const t0 = Date.now();
const ago = (ms: number) => new Date(t0 - ms).toISOString();
const DAY = 24 * 60 * MIN;

let seq = 1000;
const nextId = (prefix: string) => `${prefix}_${(++seq).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function clone<T>(v: T): T {
  return structuredClone(v);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function b64url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): string {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(pad);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Deterministic stand-in for an Ed25519 signature: a keyed hash over header.payload. */
function mockSign(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  const key = "provenant-mock-key-2026-11";
  const data = key + input;
  for (let i = 0; i < data.length; i++) {
    const c = data.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 2246822519) >>> 0;
  }
  let out = "";
  for (let i = 0; i < 8; i++) {
    h1 = Math.imul(h1 ^ (h2 >>> 7), 16777619) >>> 0;
    h2 = Math.imul(h2 ^ (h1 >>> 3), 2246822519) >>> 0;
    out += h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
  }
  return b64url(out).slice(0, 86);
}

const ISSUER = "did:web:provenant.dev";
const HEADER = b64url(JSON.stringify({ alg: "EdDSA", typ: "vc+jwt", kid: `${ISSUER}#prov-2026-11` }));

function signJwt(type: string, subject: string, credentialSubject: unknown): string {
  const payload = b64url(
    JSON.stringify({
      iss: ISSUER,
      sub: subject,
      iat: Math.floor(t0 / 1000),
      vc: {
        "@context": ["https://www.w3.org/ns/credentials/v2"],
        type: ["VerifiableCredential", type],
        credentialSubject,
      },
    }),
  );
  return `${HEADER}.${payload}.${mockSign(`${HEADER}.${payload}`)}`;
}

function decodeJwt(jwt: string): { header: string; payload: Record<string, unknown>; sig: string; body: string } | null {
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  try {
    return {
      header: parts[0],
      payload: JSON.parse(fromB64url(parts[1])) as Record<string, unknown>,
      sig: parts[2],
      body: `${parts[0]}.${parts[1]}`,
    };
  } catch {
    return null;
  }
}

function fakeSha(seed: string): string {
  let out = "";
  let h = 2166136261;
  for (let r = 0; out.length < 64; r++) {
    for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ (seed.charCodeAt(i) + r), 16777619) >>> 0;
    out += h.toString(16).padStart(8, "0");
  }
  return out.slice(0, 64);
}

// ---------------------------------------------------------------- seed data

const ALL: FlagId[] = [
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
];

const MODE: Record<FlagId, FlagResult["mode"]> = {
  F01_SIGNATURE_INVALID: "live",
  F02_TAG_CLONE: "simulated",
  F03_REUSED_TEST_CERT: "live",
  F04_DOC_METADATA_MISMATCH: "seeded",
  F05_IMPORTED_FINISHED_GOODS: "seeded",
  F06_VIRTUAL_OFFICE: "live",
  F07_IMPERSONATOR_NAME: "live",
  F08_PRICE_LEADTIME_OUTLIER: "seeded",
  F09_BANK_CHANGE_NO_REAUTH: "simulated",
  F10_UNDISCLOSED_SUBTIER_CHANGE: "seeded",
};

function seedPolicy(): BuyerPolicy {
  return {
    id: DEMO_POLICY_ID,
    name: "Hard-tech buyer policy (Buy American 2026)",
    domesticContentThreshold: 0.65,
    restrictedCountries: ["CN", "RU", "IR", "KP", "BY"],
    tierFlags: {
      low: ["F01_SIGNATURE_INVALID", "F06_VIRTUAL_OFFICE", "F07_IMPERSONATOR_NAME"],
      medium: [
        "F01_SIGNATURE_INVALID",
        "F03_REUSED_TEST_CERT",
        "F04_DOC_METADATA_MISMATCH",
        "F06_VIRTUAL_OFFICE",
        "F07_IMPERSONATOR_NAME",
        "F09_BANK_CHANGE_NO_REAUTH",
      ],
      high: [...ALL],
    },
    quarantineAtFlagCount: 1,
    blockAtFlagCount: 2,
    tierRequiredEvidence: {
      low: ["certificate_of_origin"],
      medium: ["certificate_of_origin", "facility_attestation", "certificate_of_conformance"],
      high: ["certificate_of_origin", "facility_attestation", "test_report", "bom"],
    },
    rechaseIntervalSec: 4 * 3600,
    maxChaseAttempts: 3,
  };
}

const A = DEMO.A.supplierId;
const B = DEMO.B.supplierId;
const C = DEMO.C.supplierId;

function seedSuppliers(): Supplier[] {
  const a: Supplier = {
    id: A,
    legalName: DEMO.A.legalName,
    domain: DEMO.A.domain,
    address: { line1: "4120 Research Blvd", city: "Dayton", state: "OH", zip: "45420", country: "US" },
    uei: "ADK3N7QW2LX9",
    cageCode: "7XA41",
    ein: "31-4829175",
    contactEmail: DEMO.A.contactEmail,
    claimedUsProduction: true,
    status: "enrolled",
    createdAt: ago(41 * DAY),
  };
  const b: Supplier = {
    id: B,
    legalName: DEMO.B.legalName,
    domain: DEMO.B.domain,
    address: { line1: "1880 Warm Springs Ct", city: "Fremont", state: "CA", zip: "94539", country: "US" },
    uei: "NGR8T2KD4MP6",
    cageCode: "8NG27",
    ein: "94-3318260",
    contactEmail: DEMO.B.contactEmail,
    claimedUsProduction: true,
    status: "enrolled",
    createdAt: ago(27 * DAY),
  };
  const c: Supplier = {
    id: C,
    legalName: DEMO.C.legalName,
    domain: DEMO.C.domain,
    address: { line1: "2750 Commerce Pkwy, Ste 118 #4471", city: "Reno", state: "NV", zip: "89502", country: "US" },
    ein: "88-1029384",
    contactEmail: DEMO.C.contactEmail,
    claimedUsProduction: true,
    status: "draft",
    createdAt: ago(2 * DAY),
  };
  a.credentialJwt = signJwt("SupplierCredential", a.id, { id: a.id, legalName: a.legalName, uei: a.uei, cageCode: a.cageCode });
  b.credentialJwt = signJwt("SupplierCredential", b.id, { id: b.id, legalName: b.legalName, uei: b.uei, cageCode: b.cageCode });
  return [a, b, c];
}

function check(kind: IdentityCheckResult["kind"], status: IdentityCheckResult["status"], evidence: Record<string, unknown>, at: string, source: IdentityCheckResult["source"] = "fixture"): IdentityCheckResult {
  return { kind, status, source, evidence, checkedAt: at };
}

function seedChecks(): Record<string, IdentityCheckResult[]> {
  const atA = ago(41 * DAY);
  const atB = ago(27 * DAY);
  const atC = ago(2 * DAY);
  return {
    [A]: [
      check("sam_registration", "pass", { uei: "ADK3N7QW2LX9", cageCode: "7XA41", registrationStatus: "Active", registeredSince: "2014-03-11", exclusions: 0 }, atA),
      check("sanctions", "pass", { listsScreened: ["SDN", "Entity List", "DPL", "Unverified List", "MEU"], matches: 0 }, atA),
      check("address_cmra", "pass", { cmra: false, dpvConfirmed: true, rdi: "Commercial", facilityAttestation: "signed 2026-10-02" }, atA),
      check("domain_age", "pass", { domain: DEMO.A.domain, createdAt: "2009-06-18", ageDays: 6350 }, atA),
      check("name_similarity", "pass", { closestKnownSupplier: null, score: 0.31 }, atA),
      check("shipping_history", "pass", { billsOfLading12mo: 3, importedFinishedGoods: false, note: "Inbound components only (encoders, JP)" }, atA),
    ],
    [B]: [
      check("sam_registration", "pass", { uei: "NGR8T2KD4MP6", cageCode: "8NG27", registrationStatus: "Active", registeredSince: "2019-08-02", exclusions: 0 }, atB),
      check("sanctions", "pass", { listsScreened: ["SDN", "Entity List", "DPL", "Unverified List", "MEU"], matches: 0 }, atB),
      check("address_cmra", "pass", { cmra: false, dpvConfirmed: true, rdi: "Commercial", facilityAttestation: "signed 2026-09-14" }, atB),
      check("domain_age", "pass", { domain: DEMO.B.domain, createdAt: "2018-11-05", ageDays: 2924 }, atB),
      check("name_similarity", "pass", { closestKnownSupplier: null, score: 0.22 }, atB),
      check("shipping_history", "pass", { billsOfLading12mo: 11, importedFinishedGoods: false, note: "Sub-assemblies and bearings" }, atB),
    ],
    [C]: [
      check("sam_registration", "flag", { query: DEMO.C.legalName, found: false, note: "No SAM.gov entity registration" }, atC),
      check("sanctions", "pass", { listsScreened: ["SDN", "Entity List", "DPL", "Unverified List", "MEU"], matches: 0 }, atC),
      check("address_cmra", "flag", { cmra: true, dpvConfirmed: true, rdi: "Commercial", note: "Commercial mail receiving agency (virtual office)", facilityAttestation: null }, atC),
      check("domain_age", "flag", { domain: DEMO.C.domain, createdAt: ago(23 * DAY).slice(0, 10), ageDays: 23 }, atC),
      check("name_similarity", "flag", { closestKnownSupplier: DEMO.A.legalName, score: 0.96, method: "normalized Levenshtein" }, atC),
      check("shipping_history", "skip", { reason: "No bill-of-lading records; ImportYeti covers sea freight only" }, atC),
    ],
  };
}

function ratio(components: PassportComponent[]) {
  const total = components.reduce((s, c) => s + c.costUsd, 0);
  const us = components.filter((c) => c.countryOfOrigin === "US").reduce((s, c) => s + c.costUsd, 0);
  return { total, ratio: total ? Math.round((us / total) * 1000) / 1000 : 0 };
}

const CERT_A = { certNumber: "MDTL-26-08817", issuer: "Midwest Dynamics Test Laboratory", fileSha256: fakeSha("MDTL-26-08817.pdf") };

function makePassport(p: Omit<PartPassport, "jwt" | "totalCostUsd" | "domesticContentRatio">): PartPassport {
  const { total, ratio: r } = ratio(p.components);
  const unsigned: Omit<PartPassport, "jwt"> = { ...p, totalCostUsd: total, domesticContentRatio: r };
  return { ...unsigned, jwt: signJwt("PartPassport", p.id, unsigned) };
}

const bComponents = (reducer: PassportComponent): PassportComponent[] => [
  { name: "Frameless torque motor", partNumber: "MM-FT85", supplierName: "Mesa Motorworks", countryOfOrigin: "US", costUsd: 190 },
  reducer,
  { name: "Incremental + absolute encoder", partNumber: "PS-E20", supplierName: "Pinecrest Sensors", countryOfOrigin: "US", costUsd: 80 },
  { name: "Joint controller", partNumber: "MM-JC6", supplierName: "Midland (in-house)", countryOfOrigin: "US", costUsd: 140 },
  { name: "Housing", partNumber: "MM-H6", supplierName: "Bayline Machining", countryOfOrigin: "US", costUsd: 50 },
  { name: "Crossed-roller bearing", partNumber: "TB-CR70", supplierName: "Tosa Bearing", countryOfOrigin: "JP", costUsd: 40 },
];

const B_FACILITY = { line1: "1880 Warm Springs Ct", city: "Fremont", state: "CA", zip: "94539", country: "US" };

/** Passport v2 arrives in supplier B's reply: the reducer silently moved to China (F10). */
function makeBv2(at: string): PartPassport {
  return makePassport({
    id: "pp_B_j6_v2",
    version: 2,
    prevVersionId: "pp_B_j6_v1",
    supplierId: B,
    facility: B_FACILITY,
    serialOrBatch: "MMJ6-2611-0388",
    model: "MM-J6 Robot Joint Module",
    spec: "Hollow-shaft joint, 120 N·m peak, EtherCAT",
    components: bComponents({ name: "Cycloidal reducer", partNumber: "HD-CY80", supplierName: "Hengda Precision Drive Co.", countryOfOrigin: "CN", costUsd: 150 }),
    testCertificates: [{ certNumber: "PTS-2611-4597", issuer: "Pacific Test Services", fileSha256: fakeSha("PTS-2611-4597.pdf") }],
    firmwareVersion: "1.9.2",
    issuedAt: at,
    expiresAt: new Date(t0 + 360 * DAY).toISOString(),
    statusIndex: 2211,
    revoked: false,
  });
}

function seedPassports(): PartPassport[] {
  const a = makePassport({
    id: "pp_A_ax40",
    version: 1,
    supplierId: A,
    facility: { line1: "4120 Research Blvd", city: "Dayton", state: "OH", zip: "45420", country: "US" },
    serialOrBatch: "AX40-2611-0042",
    model: "AX-40 Rotary Actuator",
    spec: "40 N·m continuous, 48 V, IP65, 17-bit absolute encoder",
    components: [
      { name: "BLDC motor stator", partNumber: "KA-MS-40", supplierName: "Keystone (in-house)", countryOfOrigin: "US", costUsd: 210 },
      { name: "Strain-wave reducer 100:1", partNumber: "KG-SW100", supplierName: "Allegheny Gearworks", countryOfOrigin: "US", costUsd: 340 },
      { name: "Absolute encoder", partNumber: "KS-AE17", supplierName: "Kitami Sensing", countryOfOrigin: "JP", costUsd: 95 },
      { name: "Drive controller PCBA", partNumber: "KA-DC-48", supplierName: "Keystone (in-house)", countryOfOrigin: "US", costUsd: 160 },
      { name: "Machined housing", partNumber: "GLC-H40", supplierName: "Great Lakes Castings", countryOfOrigin: "US", costUsd: 70 },
      { name: "NdFeB magnet set", partNumber: "RM-N42-24", supplierName: "Rheinmagnet GmbH", countryOfOrigin: "DE", costUsd: 45 },
    ],
    testCertificates: [CERT_A],
    firmwareVersion: "2.4.1",
    issuedAt: ago(6 * DAY),
    expiresAt: new Date(t0 + 365 * DAY).toISOString(),
    statusIndex: 1042,
    revoked: false,
  });
  const b1 = makePassport({
    id: "pp_B_j6_v1",
    version: 1,
    supplierId: B,
    facility: B_FACILITY,
    serialOrBatch: "MMJ6-2609-0311",
    model: "MM-J6 Robot Joint Module",
    spec: "Hollow-shaft joint, 120 N·m peak, EtherCAT",
    components: bComponents({ name: "Cycloidal reducer", partNumber: "KG-CY81", supplierName: "Allegheny Gearworks", countryOfOrigin: "US", costUsd: 260 }),
    testCertificates: [{ certNumber: "PTS-2609-4410", issuer: "Pacific Test Services", fileSha256: fakeSha("PTS-2609-4410.pdf") }],
    firmwareVersion: "1.9.0",
    issuedAt: ago(58 * DAY),
    expiresAt: new Date(t0 + 300 * DAY).toISOString(),
    statusIndex: 2210,
    revoked: false,
  });
  const c = makePassport({
    id: "pp_C_ax40",
    version: 1,
    supplierId: C,
    facility: { line1: "2750 Commerce Pkwy, Ste 118 #4471", city: "Reno", state: "NV", zip: "89502", country: "US" },
    serialOrBatch: "AX40-2610-0007",
    model: "AX-40 Rotary Actuator",
    spec: "40 N·m continuous, 48 V, IP65",
    components: [
      { name: "Motor", supplierName: "Keystone Actuation Co.", countryOfOrigin: "US", costUsd: 220 },
      { name: "Reducer", supplierName: "Keystone Actuation Co.", countryOfOrigin: "US", costUsd: 330 },
      { name: "Encoder", supplierName: "Keystone Actuation Co.", countryOfOrigin: "US", costUsd: 90 },
      { name: "Controller", supplierName: "Keystone Actuation Co.", countryOfOrigin: "US", costUsd: 150 },
    ],
    testCertificates: [CERT_A],
    issuedAt: ago(1 * DAY),
    expiresAt: new Date(t0 + 365 * DAY).toISOString(),
    statusIndex: 3301,
    revoked: false,
  });
  return [a, b1, c];
}

function doc(id: string, supplierId: string, kind: EvidenceDocument["kind"], filename: string, extracted: Record<string, unknown>, metadata: Record<string, unknown>, receivedVia: EvidenceDocument["receivedVia"], receivedAt: string, sha?: string): EvidenceDocument {
  return { id, supplierId, kind, filename, sha256: sha ?? fakeSha(filename + id), extracted, metadata, receivedVia, receivedAt };
}

function seedDocuments(): EvidenceDocument[] {
  return [
    doc("doc_a_tr", A, "test_report", "MDTL-26-08817.pdf", { certNumber: "MDTL-26-08817", issuer: "Midwest Dynamics Test Laboratory", batch: "AX40-2611-0042", result: "PASS", tests: ["Torque ripple", "IP65 ingress", "72h thermal soak"] }, { producer: "MDTL LabReport 5.2", creationDate: "2026-10-29T14:02:11Z", issuerTemplate: "mdtl-v5", pages: 14 }, "seed", ago(6 * DAY), CERT_A.fileSha256),
    doc("doc_a_coo", A, "certificate_of_origin", "KA-COO-AX40-2611.pdf", { origin: "US", manufacturer: DEMO.A.legalName, batch: "AX40-2611-0042" }, { producer: "Adobe Acrobat 24", creationDate: "2026-11-01T09:11:00Z" }, "seed", ago(6 * DAY)),
    doc("doc_a_bom", A, "bom", "AX40-BOM-rev7.xlsx.pdf", { lines: 6, domesticContentRatio: 0.848 }, { producer: "Excel → PDF", creationDate: "2026-11-01T09:20:00Z" }, "seed", ago(6 * DAY)),
    doc("doc_b_bom1", B, "bom", "MMJ6-BOM-rev3.pdf", { lines: 6, reducer: { supplier: "Allegheny Gearworks", country: "US" } }, { producer: "SolidWorks PDM", creationDate: "2026-09-10T17:40:00Z" }, "seed", ago(58 * DAY)),
  ];
}

// ---------------------------------------------------------------- flag outcomes per scenario

type Scenario = "A" | "B" | "C" | "generic";

function flagsFor(scenario: Scenario, tier: RiskTier, policy: BuyerPolicy): FlagResult[] {
  const evaluated = new Set(policy.tierFlags[tier]);
  const flagged: Partial<Record<FlagId, { evidence: Record<string, unknown>; explanation: string }>> = {};
  if (scenario === "B") {
    flagged.F10_UNDISCLOSED_SUBTIER_CHANGE = {
      evidence: { passportV1: "pp_B_j6_v1", passportV2: "pp_B_j6_v2", component: "Cycloidal reducer", from: { supplier: "Allegheny Gearworks", country: "US" }, to: { supplier: "Hengda Precision Drive Co.", country: "CN" }, changeNoticeFiled: false, restrictedCountry: "CN" },
      explanation: "Between passport v1 and v2 the cycloidal reducer moved from Allegheny Gearworks (US) to Hengda Precision Drive Co. (China). China is on this buyer's restricted list and no change notice was filed, so the sub-tier change was undisclosed.",
    };
  }
  if (scenario === "C") {
    flagged.F03_REUSED_TEST_CERT = {
      evidence: { certNumber: "MDTL-26-08817", sha256: CERT_A.fileSha256, alsoUsedBy: { supplier: DEMO.A.legalName, batch: "AX40-2611-0042" }, claimedBatch: "AX40-2610-0007" },
      explanation: `The test report MDTL-26-08817 is byte-identical (same SHA-256) to a report already on file for ${DEMO.A.legalName} batch AX40-2611-0042. A test certificate cannot cover an unrelated batch from a different supplier.`,
    };
    flagged.F06_VIRTUAL_OFFICE = {
      evidence: { address: "2750 Commerce Pkwy, Ste 118 #4471, Reno, NV 89502", cmra: true, facilityAttestation: null },
      explanation: "USPS data marks the supplier's address as a commercial mail receiving agency (a virtual office), and the supplier has not provided a signed facility attestation.",
    };
    flagged.F07_IMPERSONATOR_NAME = {
      evidence: { name: DEMO.C.legalName, closestKnownSupplier: DEMO.A.legalName, similarity: 0.96, domainAgeDays: 23, samRegistration: false },
      explanation: `"${DEMO.C.legalName}" is a 96% match to the known supplier "${DEMO.A.legalName}", its website domain was registered 23 days ago, and it has no SAM.gov registration or filing history.`,
    };
  }
  return ALL.map((flag) => {
    if (!evaluated.has(flag)) {
      return { flag, status: "skip", mode: MODE[flag], evidence: { reason: `Not required for ${tier} tier` }, explanation: `Not evaluated: the buyer policy does not require this check for ${tier}-tier orders.` };
    }
    const f = flagged[flag];
    if (f) return { flag, status: "flag", mode: MODE[flag], evidence: f.evidence, explanation: f.explanation };
    return { flag, status: "pass", mode: MODE[flag], evidence: passEvidence(flag), explanation: passExplanation(flag) };
  });
}

function passEvidence(flag: FlagId): Record<string, unknown> {
  switch (flag) {
    case "F01_SIGNATURE_INVALID":
      return { alg: "EdDSA", signatureValid: true, statusListRevoked: false };
    case "F02_TAG_CLONE":
      return { simulated: true, challengeResponse: "ok" };
    case "F08_PRICE_LEADTIME_OUTLIER":
      return { zScorePrice: 0.4, zScoreLeadTime: -0.2 };
    case "F09_BANK_CHANGE_NO_REAUTH":
      return { simulated: true, bankChangeEvents: 0 };
    default:
      return {};
  }
}

function passExplanation(flag: FlagId): string {
  switch (flag) {
    case "F01_SIGNATURE_INVALID":
      return "Passport and supplier credential signatures verify against the issuer's Ed25519 key; neither is expired or revoked.";
    case "F02_TAG_CLONE":
      return "Simulated in this build: the tag answered the challenge correctly.";
    case "F03_REUSED_TEST_CERT":
      return "Test certificate number and file hash are unique to this batch.";
    case "F04_DOC_METADATA_MISMATCH":
      return "Document metadata matches known genuine samples from the issuing lab.";
    case "F05_IMPORTED_FINISHED_GOODS":
      return "Shipping records show inbound components only, consistent with US production.";
    case "F06_VIRTUAL_OFFICE":
      return "Facility address is a deliverable commercial site with a signed facility attestation.";
    case "F07_IMPERSONATOR_NAME":
      return "No near-copy of a known supplier name; domain and SAM.gov history are established.";
    case "F08_PRICE_LEADTIME_OUTLIER":
      return "Quoted price and lead time are within the normal range for this part family.";
    case "F09_BANK_CHANGE_NO_REAUTH":
      return "Simulated in this build: no bank detail changes since the last signed authorization.";
    case "F10_UNDISCLOSED_SUBTIER_CHANGE":
      return "No sub-tier component changed origin between passport versions.";
  }
}

// ---------------------------------------------------------------- agent scripts

interface Step {
  state: AgentState;
  actor: AgentEvent["actor"];
  summary: string;
  detail?: Record<string, unknown>;
  effect?: (ctx: Ctx) => void;
}

interface Ctx {
  po: PurchaseOrder;
  agentCase: AgentCase;
  supplier: Supplier;
  at: string;
}

interface Store {
  policy: BuyerPolicy;
  suppliers: Supplier[];
  checks: Record<string, IdentityCheckResult[]>;
  passports: PartPassport[];
  documents: EvidenceDocument[];
  pos: PurchaseOrder[];
  flags: Record<string, FlagResult[]>;
  cases: AgentCase[];
  events: AgentEvent[];
  outbox: OutboundMessage[];
  /** Remaining script per case id. */
  scripts: Record<string, Step[]>;
}

let store: Store = freshStore();
/** Signed JWTs saved before a tamper demo so restore-passport can put them back. */
let originalJwts: Record<string, string> = {};

function freshStore(): Store {
  return {
    policy: seedPolicy(),
    suppliers: seedSuppliers(),
    checks: seedChecks(),
    passports: seedPassports(),
    documents: seedDocuments(),
    pos: [],
    flags: {},
    cases: [],
    events: [],
    outbox: [],
    scripts: {},
  };
}

function poLabel(po: PurchaseOrder) {
  return `PO-${po.id.replace(/^po_/, "").toUpperCase()}`;
}

function scenarioFor(supplierId: string): Scenario {
  return supplierId === A ? "A" : supplierId === B ? "B" : supplierId === C ? "C" : "generic";
}

function sendMessage(ctx: Ctx, subject: string, body: string) {
  const msg: OutboundMessage = {
    id: nextId("msg"),
    caseId: ctx.agentCase.id,
    channel: "email",
    to: ctx.supplier.contactEmail,
    subject,
    body,
    provider: "stub",
    providerMessageId: `stub-${Math.random().toString(36).slice(2, 10)}`,
    sentAt: ctx.at,
  };
  store.outbox.unshift(msg);
  return msg;
}

function addGap(ctx: Ctx, kind: EvidenceGap["kind"], description: string) {
  ctx.agentCase.gaps.push({ id: nextId("gap"), kind, description, attempts: 0 });
}

function buildScript(scenario: Scenario, po: PurchaseOrder, supplier: Supplier): Step[] {
  const label = poLabel(po);
  const passport = store.passports.find((p) => p.id === po.passportIds[po.passportIds.length - 1]);
  const part = passport ? `${passport.model} (batch ${passport.serialOrBatch})` : "the ordered part";
  const tier = po.riskTier;
  const required = store.policy.tierFlags[tier].length;
  const flagged = flagsFor(scenario, tier, store.policy).filter((f) => f.status === "flag");
  const flagIds = flagged.map((f) => f.flag.slice(0, 3));
  const decision: Decision =
    flagged.length >= store.policy.blockAtFlagCount ? "blocked" : flagged.length >= store.policy.quarantineAtFlagCount ? "quarantined" : "approved";
  const checks = store.checks[supplier.id] ?? [];
  const checkFlags = checks.filter((c) => c.status === "flag");

  const steps: Step[] = [
    {
      state: "intake",
      actor: "agent",
      summary: `Opened case for ${label}: ${part}, $${po.amountUsd.toLocaleString("en-US")}, ${tier.toUpperCase()} risk tier`,
      detail: { requiredFlagChecks: required, passports: po.passportIds },
    },
    {
      state: "screening",
      actor: "agent",
      summary:
        checkFlags.length === 0
          ? `Ran ${checks.length || 6} identity checks on ${supplier.legalName}: all passed`
          : `Ran ${checks.length} identity checks on ${supplier.legalName}: ${checkFlags.length} flagged (${checkFlags.map((c) => c.kind.replace(/_/g, " ")).join(", ")})`,
      detail: Object.fromEntries(checks.map((c) => [c.kind, c.status])),
    },
  ];

  if (scenario === "A" || scenario === "generic") {
    steps.push(
      {
        state: "gap_analysis",
        actor: "agent",
        summary: "High tier requires 4 evidence types; 1 missing: facility attestation",
        detail: { required: store.policy.tierRequiredEvidence[tier], missing: ["facility_attestation"] },
        effect: (ctx) => {
          addGap(ctx, "facility_attestation", "Signed facility attestation for the production site (none on file)");
        },
      },
      {
        state: "requesting",
        actor: "agent",
        summary: `Emailed ${supplier.contactEmail} via Naive requesting a facility attestation`,
        effect: (ctx) => {
          sendMessage(
            ctx,
            `Evidence request for ${label}: ${passport?.model ?? "purchase order"}`,
            `Hello ${supplier.legalName} compliance team,\n\nWe are verifying ${label} (${part}) under our buyer's high-tier policy. To complete verification we need a signed facility attestation for ${supplier.address.line1}, ${supplier.address.city}, ${supplier.address.state}, confirming the AX-40 is manufactured at that site.\n\nReply to this email with the PDF attached. The purchase order is on hold until it is received.\n\nProvenant compliance agent, on behalf of the buyer`,
          );
          ctx.agentCase.gaps.forEach((g) => {
            g.requestedAt = ctx.at;
            g.attempts += 1;
          });
        },
      },
      { state: "awaiting_supplier", actor: "system", summary: "Waiting on supplier reply; automatic re-chase scheduled" },
      {
        state: "awaiting_supplier",
        actor: "supplier",
        summary: `${supplier.contactEmail} replied with facility-attestation-2026.pdf`,
        detail: { attachments: ["facility-attestation-2026.pdf"] },
      },
      {
        state: "ingesting",
        actor: "agent",
        summary: "Extracted facility attestation with Claude: signed by the plant manager, site matches the passport facility",
        effect: (ctx) => {
          ctx.agentCase.gaps.forEach((g) => (g.resolvedAt = ctx.at));
          if (scenario === "A" && !store.documents.some((d) => d.id === "doc_a_fa")) {
            store.documents.push(doc("doc_a_fa", A, "facility_attestation", "facility-attestation-2026.pdf", { site: "4120 Research Blvd, Dayton, OH", signedBy: "Plant manager", signedAt: "2026-11-06" }, { producer: "DocuSign", creationDate: ctx.at }, "naive_inbox", ctx.at));
          }
        },
      },
    );
  } else if (scenario === "B") {
    steps.push(
      {
        state: "gap_analysis",
        actor: "agent",
        summary: "BOM on file is from September (rev3); 1 gap: current sub-tier BOM for the batch being ordered",
        detail: { required: store.policy.tierRequiredEvidence[tier], stale: ["bom"] },
        effect: (ctx) => addGap(ctx, "bom", "Current bill of materials with sub-tier suppliers and origin"),
      },
      {
        state: "requesting",
        actor: "agent",
        summary: `Emailed ${supplier.contactEmail} via Naive requesting the current sub-tier BOM`,
        effect: (ctx) => {
          sendMessage(
            ctx,
            `Current BOM needed for ${label}: ${passport?.model ?? ""}`,
            `Hello ${supplier.legalName} quality team,\n\nThe bill of materials we hold for the ${passport?.model ?? "MM-J6"} is revision 3 from September. Please send the current BOM, including sub-tier suppliers and country of origin, and the current part passport for the batch on this order.\n\nProvenant compliance agent, on behalf of the buyer`,
          );
          ctx.agentCase.gaps.forEach((g) => {
            g.requestedAt = ctx.at;
            g.attempts += 1;
          });
        },
      },
      { state: "awaiting_supplier", actor: "system", summary: "Waiting on supplier reply; automatic re-chase scheduled" },
      {
        state: "awaiting_supplier",
        actor: "supplier",
        summary: `${supplier.contactEmail} replied with MMJ6-BOM-rev4.pdf and passport v2 (batch MMJ6-2611-0388)`,
        detail: { attachments: ["MMJ6-BOM-rev4.pdf", "PTS-2611-4597.pdf"], passport: "pp_B_j6_v2" },
      },
      {
        state: "ingesting",
        actor: "agent",
        summary: "Extracted BOM rev4 with Claude and verified passport v2: reducer now sourced from Hengda Precision Drive Co. (CN), no change notice",
        effect: (ctx) => {
          ctx.agentCase.gaps.forEach((g) => (g.resolvedAt = ctx.at));
          if (!store.passports.some((p) => p.id === "pp_B_j6_v2")) store.passports.push(makeBv2(ctx.at));
          if (!ctx.po.passportIds.includes("pp_B_j6_v2")) ctx.po.passportIds.push("pp_B_j6_v2");
          if (!store.documents.some((d) => d.id === "doc_b_tr")) {
            store.documents.push(doc("doc_b_tr", B, "test_report", "PTS-2611-4597.pdf", { certNumber: "PTS-2611-4597", issuer: "Pacific Test Services", batch: "MMJ6-2611-0388", result: "PASS" }, { producer: "PTS Reports 3.1", creationDate: "2026-11-01T22:15:00Z", issuerTemplate: "pts-v3" }, "naive_inbox", ctx.at));
          }
          if (!store.documents.some((d) => d.id === "doc_b_bom2")) {
            store.documents.push(doc("doc_b_bom2", B, "bom", "MMJ6-BOM-rev4.pdf", { lines: 6, reducer: { supplier: "Hengda Precision Drive Co.", country: "CN" } }, { producer: "SolidWorks PDM", creationDate: "2026-11-02T18:05:00Z" }, "naive_inbox", ctx.at));
          }
        },
      },
    );
  } else {
    steps.push(
      {
        state: "gap_analysis",
        actor: "agent",
        summary: "Found 3 gaps: SAM.gov registration, facility attestation, original test report for batch AX40-2610-0007",
        effect: (ctx) => {
          addGap(ctx, "identity_field", "SAM.gov UEI / CAGE code");
          addGap(ctx, "facility_attestation", "Signed facility attestation for the production site");
          addGap(ctx, "test_report", "Original test report for batch AX40-2610-0007");
        },
      },
      {
        state: "requesting",
        actor: "agent",
        summary: `Emailed ${supplier.contactEmail} via Naive requesting identity and facility evidence`,
        effect: (ctx) => {
          sendMessage(
            ctx,
            `Verification required before ${label} can proceed`,
            `Hello ${supplier.legalName},\n\nBefore ${label} can be released we need:\n\n1. Your SAM.gov UEI and CAGE code.\n2. A signed facility attestation for the site where the AX-40 is manufactured. The address on file is a mail-receiving location.\n3. The original test report for batch AX40-2610-0007.\n\nProvenant compliance agent, on behalf of the buyer`,
          );
          ctx.agentCase.gaps.forEach((g) => {
            g.requestedAt = ctx.at;
            g.attempts += 1;
          });
        },
      },
      { state: "awaiting_supplier", actor: "system", summary: "Waiting on supplier reply; automatic re-chase scheduled" },
      {
        state: "awaiting_supplier",
        actor: "agent",
        summary: "No reply in time: re-chased via Naive (attempt 2)",
        effect: (ctx) => {
          sendMessage(
            ctx,
            `Reminder: verification required for ${label}`,
            `Hello ${supplier.legalName},\n\nWe have not received the documents requested for ${label}. The order stays on hold until they arrive. If we do not hear back, the order will be evaluated on the evidence already on file.\n\nProvenant compliance agent, on behalf of the buyer`,
          );
          ctx.agentCase.gaps.forEach((g) => (g.attempts += 1));
        },
      },
      {
        state: "awaiting_supplier",
        actor: "supplier",
        summary: `${supplier.contactEmail} replied: "Test report attached. We are a registered US manufacturer; facility paperwork to follow." (1 attachment)`,
        detail: { attachments: ["MDTL-26-08817.pdf"], missing: ["SAM.gov UEI / CAGE", "facility attestation"] },
      },
      {
        state: "ingesting",
        actor: "agent",
        summary: "Extracted MDTL-26-08817.pdf with Claude: SHA-256 matches a report already on file for Keystone Actuation Inc. batch AX40-2611-0042; no UEI or facility attestation provided",
        effect: (ctx) => {
          const tr = ctx.agentCase.gaps.find((g) => g.kind === "test_report");
          if (tr) tr.resolvedAt = ctx.at;
          if (!store.documents.some((d) => d.id === "doc_c_tr")) {
            store.documents.push(doc("doc_c_tr", C, "test_report", "MDTL-26-08817.pdf", { certNumber: "MDTL-26-08817", issuer: "Midwest Dynamics Test Laboratory", batch: "AX40-2611-0042", result: "PASS" }, { producer: "MDTL LabReport 5.2", creationDate: "2026-10-29T14:02:11Z", issuerTemplate: "mdtl-v5", pages: 14 }, "naive_inbox", ctx.at, CERT_A.fileSha256));
          }
        },
      },
    );
  }

  steps.push(
    {
      state: "evaluating",
      actor: "agent",
      summary:
        flagged.length === 0
          ? `Evaluated ${required} red-flag rules for ${tier} tier: none raised`
          : `Evaluated ${required} red-flag rules for ${tier} tier: ${flagged.length} raised (${flagIds.join(", ")})`,
      effect: (ctx) => {
        store.flags[ctx.po.id] = flagsFor(scenario, tier, store.policy);
      },
    },
    {
      state: "deciding",
      actor: "agent",
      summary:
        decision === "approved"
          ? `Policy gate: 0 flags < quarantine threshold (${store.policy.quarantineAtFlagCount}) → APPROVE`
          : decision === "quarantined"
            ? `Policy gate: ${flagged.length} flag ≥ quarantine threshold (${store.policy.quarantineAtFlagCount}) → QUARANTINE`
            : `Policy gate: ${flagged.length} flags ≥ block threshold (${store.policy.blockAtFlagCount}) → BLOCK`,
      detail: { policy: store.policy.id, flagCount: flagged.length, decision },
    },
    {
      state: "signing",
      actor: "agent",
      summary: `Signed decision record (Ed25519, kid prov-2026-11)`,
      effect: (ctx) => {
        ctx.po.decisionJwt = signJwt("PurchaseDecision", ctx.po.id, { purchaseOrderId: ctx.po.id, decision, flags: flagIds });
      },
    },
    {
      state: "enforcing",
      actor: "agent",
      summary:
        decision === "approved"
          ? `${label} approved and released for purchasing`
          : decision === "quarantined"
            ? `${label} quarantined: purchasing hold placed; supplier asked to disclose the sub-tier change`
            : `${label} blocked; supplier credential withheld`,
      effect: (ctx) => {
        ctx.po.decision = decision;
        ctx.agentCase.decision = decision;
        ctx.po.decisionReasons = reasonsFor(scenario, decision, flagged, passport);
        if (scenario === "B") {
          sendMessage(
            ctx,
            `Action required: undisclosed component change on ${label}`,
            `Hello ${supplier.legalName} quality team,\n\nPassport v2 for the MM-J6 shows the cycloidal reducer moved from Allegheny Gearworks (US) to Hengda Precision Drive Co. (China). No change notice was filed, and China is on the buyer's restricted-country list.\n\n${label} is on quarantine hold. To release it, send a signed change disclosure and either a US-origin reducer source or a waiver from the buyer.\n\nProvenant compliance agent, on behalf of the buyer`,
          );
        }
      },
    },
    decision === "blocked"
      ? { state: "closed", actor: "system", summary: "Case closed: order blocked; buyer notified" }
      : {
          state: "monitoring",
          actor: "system",
          summary: `Monitoring ${supplier.legalName} for change events (sanctions, address, ownership, passport versions)`,
        },
  );
  return steps;
}

function reasonsFor(scenario: Scenario, decision: Decision, flagged: FlagResult[], passport?: PartPassport): string[] {
  if (decision === "approved") {
    return [
      `0 red flags across ${store.policy.tierFlags.high.length} checks required for the risk tier`,
      passport ? `Domestic content ${(passport.domesticContentRatio * 100).toFixed(0)}% ≥ policy threshold ${(store.policy.domesticContentThreshold * 100).toFixed(0)}%` : "Domestic content above policy threshold",
      "Supplier credential and part passport signatures verified",
    ];
  }
  const head =
    decision === "quarantined"
      ? `${flagged.length} red flag reached the quarantine threshold (${store.policy.quarantineAtFlagCount})`
      : `${flagged.length} red flags reached the block threshold (${store.policy.blockAtFlagCount})`;
  void scenario;
  return [head, ...flagged.map((f) => f.explanation)];
}

/** When set, the seeded history uses a simulated clock so timestamps look like a real run. */
let simClock: number | null = null;

function nowIso(): string {
  if (simClock === null) return new Date().toISOString();
  simClock += 15_000 + Math.floor(Math.random() * 75_000);
  return new Date(simClock).toISOString();
}

function applyStep(caseId: string): AgentEvent | null {
  const agentCase = store.cases.find((c) => c.id === caseId);
  const script = store.scripts[caseId];
  if (!agentCase || !script || script.length === 0) return null;
  const step = script.shift()!;
  const po = store.pos.find((p) => p.id === agentCase.purchaseOrderId)!;
  const supplier = store.suppliers.find((s) => s.id === agentCase.supplierId)!;
  const at = simClock !== null ? nowIso() : new Date(Math.max(Date.now(), new Date(agentCase.updatedAt).getTime() + 1)).toISOString();
  step.effect?.({ po, agentCase, supplier, at });
  agentCase.state = step.state;
  agentCase.updatedAt = at;
  agentCase.nextRunAt = script.length > 0 ? new Date(Date.now() + 1500).toISOString() : undefined;
  const ev: AgentEvent = { id: nextId("evt"), caseId, at, state: step.state, actor: step.actor, summary: step.summary, detail: step.detail };
  store.events.push(ev);
  return ev;
}

function createPo(supplierId: string, passportIds: string[], riskTier: RiskTier, amountUsd: number, extra?: Partial<PurchaseOrder>): { po: PurchaseOrder; agentCase: AgentCase } {
  const supplier = store.suppliers.find((s) => s.id === supplierId);
  if (!supplier) throw new ApiClientError(404, `Unknown supplier ${supplierId}`);
  const now = nowIso();
  const po: PurchaseOrder = {
    id: `po_${1001 + store.pos.length}`,
    buyerPolicyId: store.policy.id,
    supplierId,
    passportIds,
    riskTier,
    amountUsd,
    decision: "pending",
    decisionReasons: [],
    createdAt: now,
    ...extra,
  };
  const agentCase: AgentCase = {
    id: `case_${po.id.slice(3)}`,
    purchaseOrderId: po.id,
    supplierId,
    riskTier,
    state: "intake",
    gaps: [],
    decision: "pending",
    startedAt: now,
    updatedAt: now,
  };
  store.pos.push(po);
  store.cases.push(agentCase);
  store.scripts[agentCase.id] = buildScript(scenarioFor(supplierId), po, supplier);
  // The case opens automatically: the first step (intake) runs on creation.
  applyStep(agentCase.id);
  return { po, agentCase };
}

function stepResponse(caseId: string, events: AgentEvent[]) {
  return { agentCase: clone(store.cases.find((c) => c.id === caseId)!), newEvents: clone(events) };
}

function poDetail(po: PurchaseOrder): PurchaseOrderDetail {
  return {
    purchaseOrder: po,
    supplier: store.suppliers.find((s) => s.id === po.supplierId)!,
    flags: store.flags[po.id] ?? [],
    agentCase: store.cases.find((c) => c.purchaseOrderId === po.id) ?? null,
  };
}

/**
 * Mirrors POST /api/demo/run: creates the three demo POs and returns immediately; the mock
 * autopilot heartbeat below then drives each case to its decision so the timeline animates.
 */
function runDemoInStore(runToCompletion = false) {
  const specs: { label: "A" | "B" | "C"; supplierId: string; passports: string[]; amount: number; price: number; lead: number }[] = [
    { label: "A", supplierId: A, passports: ["pp_A_ax40"], amount: 184_000, price: 920, lead: 42 },
    { label: "B", supplierId: B, passports: ["pp_B_j6_v1"], amount: 130_000, price: 650, lead: 35 },
    { label: "C", supplierId: C, passports: ["pp_C_ax40"], amount: 158_000, price: 790, lead: 21 },
  ];
  return specs.map((s) => {
    const { po, agentCase } = createPo(s.supplierId, s.passports, DEMO[s.label].riskTier, s.amount, { quotedUnitPriceUsd: s.price, quotedLeadTimeDays: s.lead });
    if (runToCompletion) {
      while (applyStep(agentCase.id)) {
        /* run to completion */
      }
    }
    return { supplierLabel: s.label, purchaseOrderId: po.id, caseId: agentCase.id, decision: po.decision };
  });
}

// Start with the demo already decided so every page has content; "Reset demo" returns to a clean seed.
simClock = t0 - 3 * 60 * MIN;
runDemoInStore(true);
simClock = null;

// ---------------------------------------------------------------- mock server-side autopilot

const autopilot = { enabled: true, mode: "interval" as const, intervalMs: 1500, lastTickAt: null as string | null };

function openCaseIds() {
  return store.cases.filter((c) => (store.scripts[c.id]?.length ?? 0) > 0).map((c) => c.id);
}

function tickAll() {
  autopilot.lastTickAt = new Date().toISOString();
  return openCaseIds().map((id) => {
    const ev = applyStep(id);
    return stepResponse(id, ev ? [ev] : []);
  });
}

if (typeof window !== "undefined") {
  setInterval(() => {
    if (autopilot.enabled) tickAll();
  }, autopilot.intervalMs);
}

function autopilotStatus(): AutopilotStatus {
  return { ...autopilot, openCases: openCaseIds().length };
}

// ---------------------------------------------------------------- enrollment helpers

function normName(s: string) {
  return s
    .toLowerCase()
    .replace(/[,.]/g, "")
    .replace(/\b(inc|llc|corp|corporation|co|ltd|company)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown) {
  const keys = path.split(".");
  let cur: Record<string, unknown> | unknown[] = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    const next = (cur as Record<string, unknown>)[k];
    if (next === null || typeof next !== "object") throw new ApiClientError(400, `Path ${path} not found`);
    cur = next as Record<string, unknown>;
  }
  (cur as Record<string, unknown>)[keys[keys.length - 1]] = value;
}

async function sha256Hex(base64: string): Promise<string> {
  try {
    const bin = atob(base64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return fakeSha(base64.slice(0, 256));
  }
}

function verifyJwt(jwt: string): VerifyResult {
  const d = decodeJwt(jwt);
  if (!d) return { valid: false, revoked: false, reason: "malformed" };
  const claims = d.payload;
  const vc = d.payload.vc as { credentialSubject?: Omit<PartPassport, "jwt"> } | undefined;
  const subject = vc?.credentialSubject;
  const supplier = subject ? store.suppliers.find((s) => s.id === subject.supplierId) : undefined;
  const issuer = supplier ? { supplierId: supplier.id, legalName: supplier.legalName } : undefined;
  if (d.payload.iss !== ISSUER) return { valid: false, revoked: false, reason: "unknown_issuer", claims, passport: subject, issuer };
  if (mockSign(d.body) !== d.sig) return { valid: false, revoked: false, reason: "bad_signature", claims, passport: subject, issuer };
  const stored = subject ? store.passports.find((p) => p.id === subject.id) : undefined;
  if (stored?.revoked) return { valid: false, revoked: true, reason: "revoked", claims, passport: { ...subject!, revoked: true }, issuer };
  if (subject && new Date(subject.expiresAt).getTime() < Date.now()) return { valid: false, revoked: false, reason: "expired", claims, passport: subject, issuer };
  return { valid: true, revoked: false, claims, passport: subject, issuer };
}

// ---------------------------------------------------------------- the mock Api

async function respond<T>(fn: () => T | Promise<T>, latency = 140): Promise<T> {
  await sleep(latency + Math.random() * 120);
  return clone(await fn());
}

function notFound(what: string, id: string): never {
  throw new ApiClientError(404, `${what} ${id} not found`);
}

export const mockApi: Api = {
  listSuppliers: () =>
    respond(() =>
      store.suppliers.map((supplier) => {
        const pos = store.pos.filter((p) => p.supplierId === supplier.id);
        const latest = pos[pos.length - 1];
        return {
          supplier,
          latestDecision: latest ? latest.decision : null,
          openFlagCount: latest ? (store.flags[latest.id] ?? []).filter((f) => f.status === "flag").length : 0,
        };
      }),
    ),

  getSupplier: (id) =>
    respond(() => {
      const supplier = store.suppliers.find((s) => s.id === id) ?? notFound("Supplier", id);
      return {
        supplier,
        checks: store.checks[id] ?? [],
        passports: store.passports.filter((p) => p.supplierId === id),
        documents: store.documents.filter((d) => d.supplierId === id),
      };
    }),

  enrollSupplier: (req) =>
    respond(() => {
      const now = new Date().toISOString();
      const id = nextId("sup");
      const known = store.suppliers.filter((s) => s.status === "enrolled");
      let best: { name: string; score: number } | null = null;
      for (const s of known) {
        const a = normName(s.legalName);
        const b = normName(req.legalName);
        const score = 1 - distance(a, b) / Math.max(a.length, b.length, 1);
        if (!best || score > best.score) best = { name: s.legalName, score: Math.round(score * 100) / 100 };
      }
      const nameFlag = !!best && best.score >= 0.85 && best.score < 1;
      const cmra = /#|\bpmb\b|\bp\.?o\.? box\b/i.test(req.address.line1);
      const checks: IdentityCheckResult[] = [
        check("sam_registration", req.uei ? "pass" : "flag", req.uei ? { uei: req.uei, cageCode: req.cageCode ?? null, registrationStatus: "Active" } : { found: false, note: "No UEI provided" }, now),
        check("sanctions", "pass", { listsScreened: ["SDN", "Entity List", "DPL", "Unverified List", "MEU"], matches: 0 }, now),
        check("address_cmra", cmra ? "flag" : "pass", { cmra, dpvConfirmed: true }, now),
        check("domain_age", "pass", { domain: req.domain, ageDays: 1800 + (req.domain.length * 97) % 4000 }, now),
        check("name_similarity", nameFlag ? "flag" : "pass", { closestKnownSupplier: best?.name ?? null, score: best?.score ?? 0 }, now),
        check("shipping_history", "skip", { reason: "ImportYeti key not configured (fixture mode)" }, now),
      ];
      const passing = checks.every((c) => c.status !== "flag");
      const supplier: Supplier = { id, ...req, status: passing ? "enrolled" : "draft", createdAt: now };
      if (passing) supplier.credentialJwt = signJwt("SupplierCredential", id, { id, legalName: req.legalName, uei: req.uei });
      store.suppliers.push(supplier);
      store.checks[id] = checks;
      return { supplier, checks };
    }, 600),

  uploadDocument: async (supplierId, req) => {
    if (!store.suppliers.some((s) => s.id === supplierId)) notFound("Supplier", supplierId);
    const sha256 = await sha256Hex(req.base64);
    return respond(() => {
      const reused = store.documents.find((d) => d.sha256 === sha256);
      const d: EvidenceDocument = {
        id: nextId("doc"),
        supplierId,
        kind: req.kind,
        filename: req.filename,
        sha256,
        extracted: {
          source: "fixture extraction (mock mode)",
          contentType: req.contentType,
          sizeBytes: Math.floor((req.base64.length * 3) / 4),
          ...(reused ? { duplicateOf: reused.id } : {}),
        },
        metadata: { uploadedFrom: "browser" },
        receivedVia: "upload",
        receivedAt: new Date().toISOString(),
      };
      store.documents.push(d);
      return d;
    }, 500);
  },

  createPassport: (req) =>
    respond(() => {
      const prev = req.prevVersionId ? store.passports.find((p) => p.id === req.prevVersionId) : undefined;
      const supplier = store.suppliers.find((s) => s.id === req.supplierId) ?? notFound("Supplier", req.supplierId);
      const certs = store.documents
        .filter((d) => req.testCertificateDocumentIds.includes(d.id))
        .map((d) => ({ certNumber: String(d.extracted.certNumber ?? d.filename), issuer: String(d.extracted.issuer ?? "unknown"), fileSha256: d.sha256 }));
      const p = makePassport({
        id: nextId("pp"),
        version: prev ? prev.version + 1 : 1,
        prevVersionId: prev?.id,
        supplierId: supplier.id,
        facility: supplier.address,
        serialOrBatch: req.serialOrBatch,
        model: req.model,
        spec: req.spec,
        components: req.components,
        testCertificates: certs,
        firmwareVersion: req.firmwareVersion,
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 365 * DAY).toISOString(),
        statusIndex: 4000 + store.passports.length,
        revoked: false,
      });
      store.passports.push(p);
      return p;
    }),

  getPassport: (id) => respond(() => store.passports.find((p) => p.id === id) ?? notFound("Passport", id)),

  revokePassport: (id) =>
    respond(() => {
      const p = store.passports.find((x) => x.id === id) ?? notFound("Passport", id);
      p.revoked = true;
      return p;
    }),

  verify: (jwt) => respond(() => verifyJwt(jwt), 250),

  listPurchaseOrders: () => respond(() => [...store.pos].reverse().map(poDetail)),

  getPurchaseOrder: (id) => respond(() => poDetail(store.pos.find((p) => p.id === id) ?? notFound("Purchase order", id))),

  createPurchaseOrder: (req) =>
    respond(() => {
      const { po, agentCase } = createPo(req.supplierId, req.passportIds, req.riskTier, req.amountUsd, {
        quotedUnitPriceUsd: req.quotedUnitPriceUsd,
        quotedLeadTimeDays: req.quotedLeadTimeDays,
      });
      return { purchaseOrder: po, agentCase };
    }),

  overridePurchaseOrder: (id, req) =>
    respond(() => {
      const po = store.pos.find((p) => p.id === id) ?? notFound("Purchase order", id);
      const at = new Date().toISOString();
      po.humanOverride = { decision: req.decision, reason: req.reason, at };
      po.decision = req.decision;
      const agentCase = store.cases.find((c) => c.purchaseOrderId === id);
      if (agentCase) {
        agentCase.decision = req.decision;
        agentCase.updatedAt = at;
        store.events.push({ id: nextId("evt"), caseId: agentCase.id, at, state: agentCase.state, actor: "human", summary: `Human override → ${req.decision.toUpperCase()}: ${req.reason}`, detail: { previousAgentDecision: po.decisionReasons[0] ?? null } });
      }
      return poDetail(po);
    }),

  listCases: () => respond(() => [...store.cases].reverse()),

  stepCase: (id) =>
    respond(() => {
      if (!store.cases.some((c) => c.id === id)) notFound("Case", id);
      const ev = applyStep(id);
      return stepResponse(id, ev ? [ev] : []);
    }),

  runCase: (id) =>
    respond(() => {
      if (!store.cases.some((c) => c.id === id)) notFound("Case", id);
      const evs: AgentEvent[] = [];
      for (;;) {
        const ev = applyStep(id);
        if (!ev) break;
        evs.push(ev);
        if (ev.state === "awaiting_supplier" && ev.actor === "system") break;
      }
      return stepResponse(id, evs);
    }),

  tick: () => respond(() => ({ advanced: tickAll() }), 80),

  getAutopilot: () => respond(() => autopilotStatus(), 60),

  setAutopilot: (enabled) =>
    respond(() => {
      autopilot.enabled = enabled;
      return autopilotStatus();
    }, 120),

  caseEvents: (id, after) =>
    respond(() => {
      const evs = store.events.filter((e) => e.caseId === id);
      if (!after) return evs;
      const idx = evs.findIndex((e) => e.id === after);
      return idx === -1 ? evs : evs.slice(idx + 1);
    }, 60),

  listEvents: (after, limit) =>
    respond(() => {
      const all = [...store.events].sort((a, b) => a.at.localeCompare(b.at));
      const idx = after ? all.findIndex((e) => e.id === after) : -1;
      const rest = idx === -1 ? all : all.slice(idx + 1);
      return limit ? rest.slice(-limit) : rest;
    }, 60),

  outbox: () => respond(() => store.outbox),

  resetDemo: () =>
    respond(() => {
      store = freshStore();
      originalJwts = {};
      return { ok: true as const };
    }, 300),

  runDemo: () =>
    respond(() => {
      // Mirrors the backend 409 body: { error, results } (results also under `details`).
      const labels = { [A]: "A", [B]: "B", [C]: "C" } as Record<string, DemoRunResponse["results"][number]["supplierLabel"]>;
      const existing = store.pos
        .filter((p) => p.supplierId in labels)
        .map((p) => ({
          supplierLabel: labels[p.supplierId],
          purchaseOrderId: p.id,
          caseId: store.cases.find((c) => c.purchaseOrderId === p.id)?.id ?? "",
          decision: p.decision,
        }));
      if (existing.length > 0) {
        throw new ApiClientError(409, "demo already ran — reset first", { results: existing });
      }
      autopilot.enabled = true;
      return { results: runDemoInStore() };
    }, 400),

  tamper: (req) =>
    respond(() => {
      const p = store.passports.find((x) => x.id === req.passportId) ?? notFound("Passport", req.passportId);
      const d = decodeJwt(p.jwt);
      if (!d) throw new ApiClientError(400, "Malformed passport JWT");
      const vc = d.payload.vc as { credentialSubject: Record<string, unknown> };
      setPath(vc.credentialSubject, req.path, req.value);
      const tamperedJwt = `${d.header}.${b64url(JSON.stringify(d.payload))}.${d.sig}`;
      // Persisted on the stored passport (demo only; reset restores) so /verify shows the failure.
      originalJwts[p.id] ??= p.jwt;
      p.jwt = tamperedJwt;
      return { tamperedJwt };
    }),

  restorePassport: (passportId) =>
    respond(() => {
      const p = store.passports.find((x) => x.id === passportId) ?? notFound("Passport", passportId);
      if (originalJwts[p.id]) p.jwt = originalJwts[p.id];
      delete originalJwts[p.id];
      return p;
    }),

  getPolicy: () => respond(() => store.policy),

  putPolicy: (policy) =>
    respond(() => {
      if (policy.blockAtFlagCount < policy.quarantineAtFlagCount) {
        throw new ApiClientError(400, "blockAtFlagCount must be ≥ quarantineAtFlagCount");
      }
      store.policy = clone(policy);
      return store.policy;
    }),

  integrationStatus: () =>
    respond<IntegrationStatus>(() => ({ naive: "stub", anthropic: "fixture", samGov: "fixture", storage: "memory",
      signingKeys: "persistent",
      publicBaseUrl: null,
      checkSources: {
        sam_registration: "fixture",
        sanctions: "fixture",
        address_cmra: "fixture",
        domain_age: "fixture",
        name_similarity: "live",
        shipping_history: "fixture",
      },
    })),
};
