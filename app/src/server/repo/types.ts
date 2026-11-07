// Repository port. Route handlers and the agent depend only on this interface; the in-memory
// implementation is the default and Supabase is used when SUPABASE_URL + key are set.
import type {
  AgentCase,
  AgentEvent,
  BuyerPolicy,
  EvidenceDocument,
  FlagResult,
  IdentityCheckResult,
  NaiveInboundMessage,
  OutboundMessage,
  PartPassport,
  PurchaseOrder,
  Supplier,
} from "@/contracts";

export interface Entity {
  id: string;
}

/** Latest Loop 1 results for a supplier (id = supplierId). */
export interface StoredIdentityChecks extends Entity {
  supplierId: string;
  results: IdentityCheckResult[];
  checkedAt: string;
}

/** Red-flag results for a purchase order (id = purchaseOrderId). */
export interface StoredFlagResults extends Entity {
  purchaseOrderId: string;
  flags: FlagResult[];
  evaluatedAt: string;
}

/** Inbound supplier message (from Naive poll or webhook), queued until the agent ingests it. */
export interface StoredInbound extends Entity {
  caseId: string;
  message: NaiveInboundMessage;
  processed: boolean;
  /** Sender was not the case supplier: never ingested, does not count as a reply. */
  ignored?: boolean;
  receivedAt: string;
}

/** Bitstring Status List state (id = list name, e.g. "passports"). */
export interface StoredStatusList extends Entity {
  purpose: "revocation";
  nextIndex: number;
  revokedIndices: number[];
}

/** Demo bookkeeping: label -> seeded entity ids. */
export interface StoredMeta extends Entity {
  seededAt: string;
  suppliers: Record<"A" | "B" | "C", string>;
  passports: Record<"A" | "B" | "C", string>;
  policyId: string;
  /** Supplier-signed passports not yet sent to us; the (stub) supplier attaches them to a reply. */
  pendingPassports: Record<string, PartPassport>;
  /** Original signed JWTs of passports tampered via /api/demo/tamper (for /api/demo/restore-passport). */
  originalJwts?: Record<string, string>;
  /** Set by /api/demo/run; cleared by /api/demo/reset. A second run before a reset is refused (409). */
  demoRun?: { supplierLabel: "A" | "B" | "C"; purchaseOrderId: string; caseId: string }[];
  /** Request-mode autopilot switch shared by all instances (default on). Survives /api/demo/reset. */
  autopilotEnabled?: boolean;
}

export interface Collection<T extends Entity> {
  get(id: string): Promise<T | null>;
  /** Insertion order. `where` is a shallow equality filter on top-level fields. */
  list(where?: Partial<T>): Promise<T[]>;
  put(item: T): Promise<T>;
  delete(id: string): Promise<void>;
}

export interface Repo {
  readonly kind: "memory" | "supabase" | "redis";
  /** Shared stores: pull the latest remote state (no-op for local stores). */
  sync?(): Promise<void>;
  /** Shared stores: write pending mutations (no-op for local stores). */
  commit?(): Promise<void>;
  suppliers: Collection<Supplier>;
  identityChecks: Collection<StoredIdentityChecks>;
  passports: Collection<PartPassport>;
  documents: Collection<EvidenceDocument>;
  policies: Collection<BuyerPolicy>;
  purchaseOrders: Collection<PurchaseOrder>;
  flagResults: Collection<StoredFlagResults>;
  cases: Collection<AgentCase>;
  events: Collection<AgentEvent>;
  outbox: Collection<OutboundMessage>;
  inbox: Collection<StoredInbound>;
  statusLists: Collection<StoredStatusList>;
  meta: Collection<StoredMeta>;
  /** Drop everything (demo reset). */
  clear(): Promise<void>;
}

export const COLLECTIONS = [
  "suppliers",
  "identityChecks",
  "passports",
  "documents",
  "policies",
  "purchaseOrders",
  "flagResults",
  "cases",
  "events",
  "outbox",
  "inbox",
  "statusLists",
  "meta",
] as const;
export type CollectionName = (typeof COLLECTIONS)[number];
