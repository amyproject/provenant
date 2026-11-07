// Shared domain model. OWNER: lead. Other agents: read-only — request changes via the lead.
// Design rule from the spec: AI extracts and explains, deterministic rules decide, cryptography proves.

export type RiskTier = "low" | "medium" | "high";
export type Decision = "pending" | "approved" | "quarantined" | "blocked";
/** How a check ran: live logic on live data, live logic on seeded data, or UI-only simulation. */
export type RunMode = "live" | "seeded" | "simulated";
export type DataSource = "live" | "fixture";

export interface Address {
  line1: string;
  city: string;
  state: string;
  zip: string;
  country: string; // ISO-3166 alpha-2
}

// ---------- Loop 1: Supplier identity ----------

export interface Supplier {
  id: string;
  legalName: string;
  domain: string;
  address: Address;
  uei?: string;
  cageCode?: string;
  ein?: string;
  contactEmail: string;
  claimedUsProduction: boolean;
  status: "draft" | "enrolled" | "revoked";
  /** Signed W3C VC 2.0 supplier credential (Ed25519 JWT), set after enrollment passes. */
  credentialJwt?: string;
  createdAt: string; // ISO timestamp
}

export type IdentityCheckKind =
  | "sam_registration"
  | "sanctions"
  | "address_cmra"
  | "domain_age"
  | "name_similarity"
  | "shipping_history";

export interface IdentityCheckResult {
  kind: IdentityCheckKind;
  status: "pass" | "flag" | "skip" | "error";
  source: DataSource;
  evidence: Record<string, unknown>;
  checkedAt: string;
}

// ---------- Loop 2: Part passport ----------

export interface PassportComponent {
  name: string;
  partNumber?: string;
  supplierName: string;
  countryOfOrigin: string; // ISO-3166 alpha-2
  costUsd: number;
  /** Loop 3 hook: signed passport of the sub-tier component, if any. */
  childPassportId?: string;
}

export interface TestCertificateRef {
  certNumber: string;
  issuer: string;
  fileSha256: string;
}

export interface PartPassport {
  id: string;
  version: number;
  prevVersionId?: string;
  supplierId: string;
  facility: Address;
  serialOrBatch: string;
  model: string;
  spec: string;
  components: PassportComponent[];
  totalCostUsd: number;
  /** Share of component cost with US origin, 0..1 — input to the domestic-content test. */
  domesticContentRatio: number;
  testCertificates: TestCertificateRef[];
  firmwareVersion?: string;
  issuedAt: string;
  expiresAt: string;
  /** Index into the Bitstring Status List used for revocation. */
  statusIndex: number;
  revoked: boolean;
  /** Ed25519-signed VC JWT over the passport claims. The JWT, not the DB row, is the proof. */
  jwt: string;
}

// ---------- Evidence ----------

export type EvidenceKind =
  | "certificate_of_origin"
  | "test_report"
  | "certificate_of_conformance"
  | "facility_attestation"
  | "bom"
  | "other";

export interface EvidenceDocument {
  id: string;
  supplierId: string;
  kind: EvidenceKind;
  filename: string;
  sha256: string;
  /** Typed fields extracted by Claude (or fixture), e.g. certNumber, issuer, components. */
  extracted: Record<string, unknown>;
  /** File metadata used by flag 4 (producer, creationDate, issuer template signature...). */
  metadata: Record<string, unknown>;
  receivedVia: "upload" | "naive_inbox" | "seed";
  receivedAt: string;
}

// ---------- Red flags ----------

export type FlagId =
  | "F01_SIGNATURE_INVALID"
  | "F02_TAG_CLONE"
  | "F03_REUSED_TEST_CERT"
  | "F04_DOC_METADATA_MISMATCH"
  | "F05_IMPORTED_FINISHED_GOODS"
  | "F06_VIRTUAL_OFFICE"
  | "F07_IMPERSONATOR_NAME"
  | "F08_PRICE_LEADTIME_OUTLIER"
  | "F09_BANK_CHANGE_NO_REAUTH"
  | "F10_UNDISCLOSED_SUBTIER_CHANGE";

export interface FlagResult {
  flag: FlagId;
  status: "pass" | "flag" | "skip";
  mode: RunMode;
  evidence: Record<string, unknown>;
  /** Plain-English reason (Claude-written when available, template otherwise). */
  explanation: string;
}

// ---------- Loop 5: Policy gate ----------

export interface BuyerPolicy {
  id: string;
  name: string;
  /** Buy American threshold: 0.65 through 2028, 0.75 from 2029. Configurable. */
  domesticContentThreshold: number;
  restrictedCountries: string[]; // ISO-3166 alpha-2
  /** Flags evaluated per tier. Spec: low = identity+sanctions+signature; high adds sub-tier etc. */
  tierFlags: Record<RiskTier, FlagId[]>;
  quarantineAtFlagCount: number; // spec: 1
  blockAtFlagCount: number; // spec: 2
  /** Evidence the agent must hold before deciding, per tier; drives gap analysis. */
  tierRequiredEvidence: Record<RiskTier, EvidenceKind[]>;
  /** Agent re-chases an unanswered evidence request after this many seconds. */
  rechaseIntervalSec: number;
  /** After this many unanswered requests the agent escalates to a human. */
  maxChaseAttempts: number;
}

export interface PurchaseOrder {
  id: string;
  buyerPolicyId: string;
  supplierId: string;
  passportIds: string[];
  riskTier: RiskTier;
  amountUsd: number;
  quotedUnitPriceUsd?: number;
  quotedLeadTimeDays?: number;
  decision: Decision;
  decisionReasons: string[];
  /** Signed decision record so the outcome itself is auditable. */
  decisionJwt?: string;
  humanOverride?: { decision: Decision; reason: string; at: string };
  createdAt: string;
}

// ---------- Autonomous compliance agent ----------
// One AgentCase per purchase order. The agent drives the case through these states on its own
// and only hands off to a human on escalation.

export type AgentState =
  | "intake" // read PO + BOM, determine risk tier and required evidence
  | "screening" // identity checks (Loop 1)
  | "gap_analysis" // compare required evidence vs what we hold
  | "requesting" // send evidence requests to supplier (via Naive)
  | "awaiting_supplier" // waiting on reply; re-chases on a schedule
  | "ingesting" // extract received docs with Claude
  | "evaluating" // run red-flag engine
  | "deciding" // policy gate
  | "signing" // sign decision record
  | "enforcing" // approve / quarantine / block the PO
  | "monitoring" // Loop 4: watch for change events after approval
  | "escalated" // needs a human
  | "closed";

export interface EvidenceGap {
  id: string;
  kind: EvidenceKind | "identity_field";
  description: string;
  requestedAt?: string;
  resolvedAt?: string;
  attempts: number;
}

export interface AgentCase {
  id: string;
  purchaseOrderId: string;
  supplierId: string;
  riskTier: RiskTier;
  state: AgentState;
  gaps: EvidenceGap[];
  decision: Decision;
  /** When the autopilot heartbeat should next advance this case (e.g. re-chase time). */
  nextRunAt?: string;
  escalationReason?: string;
  startedAt: string;
  updatedAt: string;
}

export interface AgentEvent {
  id: string;
  caseId: string;
  at: string;
  state: AgentState;
  actor: "agent" | "supplier" | "human" | "system";
  summary: string;
  detail?: Record<string, unknown>;
}

export interface OutboundMessage {
  id: string;
  caseId: string;
  channel: "email";
  to: string;
  subject: string;
  body: string;
  provider: "naive" | "stub";
  providerMessageId?: string;
  sentAt: string;
}

export interface VerifyResult {
  valid: boolean;
  revoked: boolean;
  /** Why verification failed: bad signature, expired, revoked, unknown issuer, malformed. */
  reason?: "bad_signature" | "expired" | "revoked" | "unknown_issuer" | "malformed" | "not_found";
  /** Claims decoded from the JWT itself (shown even when the signature fails, to expose the tamper). */
  claims?: Record<string, unknown>;
  passport?: Omit<PartPassport, "jwt">;
  issuer?: { supplierId: string; legalName: string };
}
