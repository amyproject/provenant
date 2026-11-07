import type {
  BuyerPolicy,
  EvidenceDocument,
  FlagId,
  FlagResult,
  IdentityCheckResult,
  PartPassport,
  PurchaseOrder,
  RunMode,
  Supplier,
  VerifyResult,
} from "@/contracts";

export interface IssuerSample {
  producers: string[];
  templateIds: string[];
  certNumberPattern?: string;
}

export interface PriceBaseline {
  category: string;
  models: string[];
  unitPriceMeanUsd: number;
  unitPriceStdUsd: number;
  minFeasibleLeadTimeDays: number;
  sampleSize: number;
}

export interface TagChallenge {
  result: "pass" | "fail" | "no_tag";
  tagUid: string | null;
}

export interface BankChangeEvent {
  supplierId: string;
  at: string;
  reauthenticated: boolean;
  detail?: string;
}

/** Everything a rule may look at. Built by the agent; rules are pure functions of this. */
export interface FlagContext {
  now: string;
  po: PurchaseOrder;
  supplier: Supplier;
  policy: BuyerPolicy;
  /** Passports on the PO, and their verification results (by passport id). */
  passports: PartPassport[];
  verifications: Record<string, VerifyResult>;
  /** Previous version of each PO passport (by current passport id), if any. */
  previousVersions: Record<string, PartPassport | undefined>;
  identityChecks: IdentityCheckResult[];
  /** The supplier's evidence documents. */
  documents: EvidenceDocument[];
  /** All passports and documents in the system (for cross-supplier reuse checks). */
  allPassports: PartPassport[];
  allDocuments: EvidenceDocument[];
  allSuppliers: Supplier[];
  issuerSamples: Record<string, IssuerSample>;
  priceBaselines: PriceBaseline[];
  priceZThreshold: number;
  tagChallenges: Record<string, TagChallenge>;
  bankChanges: BankChangeEvent[];
}

export type FlagRule = (ctx: FlagContext) => FlagResult;

export function flagResult(
  flag: FlagId,
  mode: RunMode,
  status: FlagResult["status"],
  evidence: Record<string, unknown>,
  explanation: string,
): FlagResult {
  return { flag, mode, status, evidence, explanation };
}
