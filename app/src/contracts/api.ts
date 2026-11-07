// HTTP contract between frontend and backend. OWNER: lead.
// All routes live under src/app/api (backend-owned) and return JSON.
// Errors: non-2xx with body ApiError.

import type {
  AgentCase,
  AgentEvent,
  BuyerPolicy,
  EvidenceDocument,
  EvidenceKind,
  FlagResult,
  IdentityCheckResult,
  OutboundMessage,
  PartPassport,
  PassportComponent,
  PurchaseOrder,
  RiskTier,
  Supplier,
  Decision,
  Address,
  VerifyResult,
  IdentityCheckKind,
  DataSource,
} from "./domain";

export interface ApiError {
  error: string;
  details?: unknown;
}

// GET /api/suppliers
export interface SupplierSummary {
  supplier: Supplier;
  latestDecision: Decision | null;
  openFlagCount: number;
}
export type ListSuppliersResponse = SupplierSummary[];

// POST /api/suppliers  (enroll; runs Loop 1 checks synchronously, signs credential if passing)
export interface EnrollSupplierRequest {
  legalName: string;
  domain: string;
  address: Address;
  uei?: string;
  cageCode?: string;
  ein?: string;
  contactEmail: string;
  claimedUsProduction: boolean;
}
export interface EnrollSupplierResponse {
  supplier: Supplier;
  checks: IdentityCheckResult[];
}

// GET /api/suppliers/:id
export interface SupplierDetailResponse {
  supplier: Supplier;
  checks: IdentityCheckResult[];
  passports: PartPassport[];
  documents: EvidenceDocument[];
}

// POST /api/suppliers/:id/documents  (JSON; file as base64; Claude extracts fields)
export interface UploadDocumentRequest {
  kind: EvidenceKind;
  filename: string;
  contentType: string;
  base64: string;
}
export type UploadDocumentResponse = EvidenceDocument;

// POST /api/passports  (create + sign)
export interface CreatePassportRequest {
  supplierId: string;
  serialOrBatch: string;
  model: string;
  spec: string;
  components: PassportComponent[];
  testCertificateDocumentIds: string[];
  firmwareVersion?: string;
  /** If set, creates a new version of an existing passport (used by flag 10). */
  prevVersionId?: string;
}
export type CreatePassportResponse = PartPassport;

// GET /api/passports/:id -> PartPassport
// POST /api/passports/:id/revoke -> PartPassport

// POST /api/verify  { jwt }  — public; also used by the QR page /verify/[passportId]
export interface VerifyRequest {
  jwt: string;
}
export type VerifyResponse = VerifyResult;

// POST /api/purchase-orders  (creates PO and starts an AgentCase automatically)
export interface CreatePurchaseOrderRequest {
  supplierId: string;
  passportIds: string[];
  riskTier: RiskTier;
  amountUsd: number;
  quotedUnitPriceUsd?: number;
  quotedLeadTimeDays?: number;
  buyerPolicyId?: string; // defaults to the seeded policy
}
export interface CreatePurchaseOrderResponse {
  purchaseOrder: PurchaseOrder;
  agentCase: AgentCase;
}

// GET /api/purchase-orders -> PurchaseOrderDetail[]
// GET /api/purchase-orders/:id -> PurchaseOrderDetail
export interface PurchaseOrderDetail {
  purchaseOrder: PurchaseOrder;
  supplier: Supplier;
  flags: FlagResult[];
  agentCase: AgentCase | null;
}

// POST /api/purchase-orders/:id/override  (human-in-the-loop escape hatch) -> PurchaseOrderDetail
// Sets purchaseOrder.decision to the override AND records purchaseOrder.humanOverride; the agent's
// original decision stays in decisionReasons + the signed decisionJwt. Logs a human AgentEvent.
export interface OverrideRequest {
  decision: Exclude<Decision, "pending">;
  reason: string;
}

// ---------- Autonomous agent ----------
// POST /api/agent/cases/:id/step   -> AgentStepResponse  (advance exactly one state)
// POST /api/agent/cases/:id/run    -> AgentStepResponse  (advance until awaiting_supplier/closed/escalated)
// POST /api/agent/tick             -> AgentTickResponse  (advance every open case one step; the "autopilot" heartbeat)
// GET  /api/agent/cases            -> AgentCase[]
// GET  /api/agent/cases/:id/events?after=<eventId> -> AgentEvent[]   (UI polls this)
// GET  /api/agent/events?after=<eventId>&limit=<n> -> AgentEvent[]   (all cases, returned oldest→newest;
//      with `after`: the next <n> events after it; without `after`: the NEWEST <n> events; default limit 50)
// GET  /api/agent/outbox           -> OutboundMessage[]
export interface AgentStepResponse {
  agentCase: AgentCase;
  newEvents: AgentEvent[];
}
export interface AgentTickResponse {
  advanced: AgentStepResponse[];
}
export type AgentEventsResponse = AgentEvent[];
export type AgentOutboxResponse = OutboundMessage[];

// ---------- Demo + integrations ----------
// When DEMO_ADMIN_TOKEN is set (public deploys), EVERY non-GET route requires header `x-demo-token` to equal it,
// except POST /api/verify (public) and POST /api/webhooks/naive (accepts x-demo-token OR, later, Naive's
// webhook signature; interim: header `x-webhook-secret` == NAIVE_WEBHOOK_SECRET). Unset = open (local dev).
// POST /api/demo/reset   -> { ok: true }   reseeds suppliers A/B/C, policy, passports, docs
// POST /api/demo/run     -> DemoRunResponse  creates the 3 demo POs and returns IMMEDIATELY; the
//                           server-side autopilot then drives each case to its decision (paced by
//                           AGENT_STEP_DELAY_MS so the UI timeline visibly animates). No clicks needed.
// POST /api/demo/restore-passport { passportId } -> PartPassport  restores ONE passport's original signed JWT
//                           (verify-page "Restore" must use this, not /demo/reset which wipes POs mid-demo)
// POST /api/demo/tamper  -> TamperResponse   edits one claim in a passport JWT payload WITHOUT re-signing
//                           and PERSISTS the tampered JWT on the stored passport (demo only; reset restores),
//                           so /verify/[passportId] then shows the signature failure.
export interface DemoRunResponse {
  results: { supplierLabel: "A" | "B" | "C"; purchaseOrderId: string; caseId: string; decision: Decision }[];
}

// GET /api/agent/autopilot -> AutopilotStatus  (server heartbeat that advances due cases on its own)
// POST /api/agent/autopilot { enabled } -> AutopilotStatus
export interface AutopilotStatus {
  enabled: boolean;
  /** "interval": in-process timer (single Node host). "request": serverless (e.g. Vercel); due cases advance on
   *  every API request plus after() continuations, so the agent keeps moving while anyone has the app open. */
  mode: "interval" | "request";
  intervalMs: number;
  lastTickAt: string | null;
  openCases: number;
}
export interface TamperRequest {
  passportId: string;
  /** Dot path into the VC credentialSubject, e.g. "components.0.countryOfOrigin". */
  path: string;
  value: unknown;
}
export interface TamperResponse {
  tamperedJwt: string;
}

// GET /api/policy -> BuyerPolicy ; PUT /api/policy (body BuyerPolicy) -> BuyerPolicy
export type PolicyResponse = BuyerPolicy;

// GET /api/integrations/status
export interface IntegrationStatus {
  /** "live_pending": NAIVE_API_KEY is set but the live adapter isn't implemented yet → still running on stub. */
  naive: "stub" | "live" | "live_pending";
  anthropic: "fixture" | "live";
  samGov: "fixture" | "live";
  storage: "memory" | "redis" | "supabase";
  /** "ephemeral": signing keys generated per server instance (serverless without SIGNING_PRIVATE_JWK) → verification
   *  can disagree across instances. "persistent": keys from SIGNING_PRIVATE_JWK or a writable DATA_DIR. */
  signingKeys: "persistent" | "ephemeral";
  /** PUBLIC_BASE_URL read at request time (QR codes target this); null → client uses window.location.origin. */
  publicBaseUrl: string | null;
  /** Data source behind each identity check (USPS CMRA, RDAP, CSL, ImportYeti, SAM, name match). */
  checkSources: Record<IdentityCheckKind, DataSource>;
}

// POST /api/webhooks/naive  — inbound supplier replies (live mode)
