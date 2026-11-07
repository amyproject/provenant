// UI copy and display metadata for contract enums. Pure data, no React.
import type {
  AgentState,
  EvidenceKind,
  FlagId,
  IdentityCheckKind,
  RiskTier,
  RunMode,
} from "@/contracts";

export interface FlagMeta {
  id: FlagId;
  num: number;
  title: string;
  method: string;
  /** How the flag runs in the hackathon build, per the spec. */
  hackathonMode: RunMode;
}

export const FLAG_META: Record<FlagId, FlagMeta> = {
  F01_SIGNATURE_INVALID: {
    id: "F01_SIGNATURE_INVALID",
    num: 1,
    title: "Signature invalid, expired or revoked",
    method: "Ed25519 signature verification + Bitstring Status List",
    hackathonMode: "live",
  },
  F02_TAG_CLONE: {
    id: "F02_TAG_CLONE",
    num: 2,
    title: "Tag clone (challenge-response failed)",
    method: "Secure NFC tag challenge",
    hackathonMode: "simulated",
  },
  F03_REUSED_TEST_CERT: {
    id: "F03_REUSED_TEST_CERT",
    num: 3,
    title: "Test certificate reused across batches",
    method: "File hash + extracted certificate number match",
    hackathonMode: "live",
  },
  F04_DOC_METADATA_MISMATCH: {
    id: "F04_DOC_METADATA_MISMATCH",
    num: 4,
    title: "Document metadata does not match issuer",
    method: "PDF metadata vs. known issuer samples",
    hackathonMode: "seeded",
  },
  F05_IMPORTED_FINISHED_GOODS: {
    id: "F05_IMPORTED_FINISHED_GOODS",
    num: 5,
    title: "Claims US production, imports finished goods",
    method: "ImportYeti bill-of-lading search",
    hackathonMode: "seeded",
  },
  F06_VIRTUAL_OFFICE: {
    id: "F06_VIRTUAL_OFFICE",
    num: 6,
    title: "Virtual office, no facility evidence",
    method: "USPS CMRA flag + facility attestation",
    hackathonMode: "live",
  },
  F07_IMPERSONATOR_NAME: {
    id: "F07_IMPERSONATOR_NAME",
    num: 7,
    title: "Near-copy of a known supplier name",
    method: "Fuzzy name match + RDAP domain age + SAM.gov dates",
    hackathonMode: "live",
  },
  F08_PRICE_LEADTIME_OUTLIER: {
    id: "F08_PRICE_LEADTIME_OUTLIER",
    num: 8,
    title: "Impossible price or lead time",
    method: "Statistical outlier test vs. fleet baseline",
    hackathonMode: "seeded",
  },
  F09_BANK_CHANGE_NO_REAUTH: {
    id: "F09_BANK_CHANGE_NO_REAUTH",
    num: 9,
    title: "Bank details changed without re-auth",
    method: "Change event requiring a fresh signature",
    hackathonMode: "simulated",
  },
  F10_UNDISCLOSED_SUBTIER_CHANGE: {
    id: "F10_UNDISCLOSED_SUBTIER_CHANGE",
    num: 10,
    title: "Undisclosed sub-tier move to restricted country",
    method: "Passport version comparison",
    hackathonMode: "seeded",
  },
};

/** Identity checks whose data feeds each flag; drives the "live logic · fixture data" label. */
export const FLAG_CHECK_INPUTS: Partial<Record<FlagId, IdentityCheckKind[]>> = {
  F05_IMPORTED_FINISHED_GOODS: ["shipping_history"],
  F06_VIRTUAL_OFFICE: ["address_cmra"],
  F07_IMPERSONATOR_NAME: ["domain_age", "name_similarity", "sam_registration"],
};

export const ALL_FLAGS = Object.keys(FLAG_META) as FlagId[];

export function flagLabel(id: FlagId): string {
  const m = FLAG_META[id];
  return m ? `F${String(m.num).padStart(2, "0")}` : id;
}

/** Ordered happy path the agent walks; used for the progress rail. */
export const AGENT_PIPELINE: AgentState[] = [
  "intake",
  "screening",
  "gap_analysis",
  "requesting",
  "awaiting_supplier",
  "ingesting",
  "evaluating",
  "deciding",
  "signing",
  "enforcing",
  "monitoring",
];

export const AGENT_STATE_LABEL: Record<AgentState, string> = {
  intake: "Intake",
  screening: "Screening",
  gap_analysis: "Gap analysis",
  requesting: "Requesting evidence",
  awaiting_supplier: "Awaiting supplier",
  ingesting: "Ingesting",
  evaluating: "Evaluating flags",
  deciding: "Deciding",
  signing: "Signing",
  enforcing: "Enforcing",
  monitoring: "Monitoring",
  escalated: "Escalated",
  closed: "Closed",
};

export const AGENT_STATE_HINT: Record<AgentState, string> = {
  intake: "Read PO + BOM, determine risk tier and required evidence",
  screening: "Loop 1 identity checks: SAM, sanctions, CMRA, domain age, name similarity",
  gap_analysis: "Compare required evidence against what is on file",
  requesting: "Send evidence requests to the supplier via Naive",
  awaiting_supplier: "Waiting on supplier reply; re-chases on a schedule",
  ingesting: "Claude extracts received PDFs into typed JSON",
  evaluating: "Run the 10 deterministic red-flag rules",
  deciding: "Apply buyer policy gate",
  signing: "Sign the decision record (Ed25519)",
  enforcing: "Approve, quarantine or block the purchase order",
  monitoring: "Loop 4: watch for change events after approval",
  escalated: "Agent cannot proceed; needs a human",
  closed: "Case closed",
};

export const TERMINAL_STATES: AgentState[] = ["monitoring", "closed", "escalated"];

export const IDENTITY_CHECK_LABEL: Record<IdentityCheckKind, { title: string; source: string }> = {
  sam_registration: { title: "SAM.gov registration", source: "SAM.gov Entity API" },
  sanctions: { title: "Sanctions & denied parties", source: "Consolidated Screening List" },
  address_cmra: { title: "Facility address (CMRA)", source: "USPS via Address Validation" },
  domain_age: { title: "Website domain age", source: "RDAP" },
  name_similarity: { title: "Name similarity to known suppliers", source: "Fuzzy match" },
  shipping_history: { title: "Shipping history", source: "ImportYeti" },
};

export const EVIDENCE_KIND_LABEL: Record<EvidenceKind, string> = {
  certificate_of_origin: "Certificate of origin",
  test_report: "Test report",
  certificate_of_conformance: "Certificate of conformance",
  facility_attestation: "Facility attestation",
  bom: "Bill of materials",
  other: "Other",
};

export const RISK_TIER_LABEL: Record<RiskTier, string> = {
  low: "Low — standard parts",
  medium: "Medium",
  high: "High — safety-critical",
};

export const RUN_MODE_HINT: Record<RunMode, string> = {
  live: "Real detection logic; inputs may be live or fixture (see data sources)",
  seeded: "Live logic on prepared (seeded) data",
  simulated: "Shown in the interface only; no real check ran",
};

export const INTEGRATIONS = {
  naive: {
    name: "Naive",
    role: "Outbound supplier email + inbound replies for the autonomous agent",
    env: ["NAIVE_API_KEY"],
    liveValue: "live",
    offLabel: "Stub — token pending",
    pendingLabel: "Naive key detected — live adapter pending docs",
  },
  anthropic: {
    name: "Anthropic Claude",
    role: "PDF extraction to typed JSON and plain-English flag explanations",
    env: ["ANTHROPIC_API_KEY"],
    liveValue: "live",
    offLabel: "Fixture extraction",
  },
  samGov: {
    name: "SAM.gov",
    role: "Entity registration, UEI, CAGE and exclusions",
    env: ["SAM_GOV_API_KEY"],
    liveValue: "live",
    offLabel: "Fixture responses",
  },
  storage: {
    name: "Storage",
    role: "Suppliers, passports, flags, agent cases and audit log",
    env: ["KV_REST_API_URL", "KV_REST_API_TOKEN"],
    liveValue: "supabase",
    altLiveValue: "redis",
    offLabel: "In-memory (per server instance)",
  },
} as const;
