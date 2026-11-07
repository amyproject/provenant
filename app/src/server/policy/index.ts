// Loop 5 policy gate. Deterministic: buyer policy x risk tier x flag results -> decision.
// 0 counted issues approve, >= quarantineAtFlagCount quarantine, >= blockAtFlagCount block.
import type { BuyerPolicy, Decision, EvidenceGap, FlagId, FlagResult, IdentityCheckResult, PartPassport, RiskTier } from "@/contracts";

export const FLAG_TITLES: Record<FlagId, string> = {
  F01_SIGNATURE_INVALID: "Signature invalid, expired or revoked",
  F02_TAG_CLONE: "Tag clone detected",
  F03_REUSED_TEST_CERT: "Reused test certificate",
  F04_DOC_METADATA_MISMATCH: "Document metadata mismatch",
  F05_IMPORTED_FINISHED_GOODS: "Imported finished goods",
  F06_VIRTUAL_OFFICE: "Virtual office, no facility evidence",
  F07_IMPERSONATOR_NAME: "Impersonator name",
  F08_PRICE_LEADTIME_OUTLIER: "Impossible price or lead time",
  F09_BANK_CHANGE_NO_REAUTH: "Bank change without re-authentication",
  F10_UNDISCLOSED_SUBTIER_CHANGE: "Undisclosed sub-tier change",
};

export interface PolicyInput {
  policy: BuyerPolicy;
  riskTier: RiskTier;
  flags: FlagResult[];
  passports: PartPassport[];
  identityChecks: IdentityCheckResult[];
  /** Required evidence still missing after the agent exhausted its requests. */
  unresolvedGaps?: EvidenceGap[];
}

export interface PolicyDecision {
  decision: Exclude<Decision, "pending">;
  reasons: string[];
  /** Issues counted against the thresholds (tier flags raised + domestic shortfall + missing evidence). */
  issueCount: number;
  countedFlags: FlagId[];
  domesticContent: { passportId: string; ratio: number; threshold: number; meets: boolean }[];
  hardStop: string | null;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function applyPolicy(input: PolicyInput): PolicyDecision {
  const { policy, riskTier, flags, passports, identityChecks, unresolvedGaps = [] } = input;
  const required = new Set(policy.tierFlags[riskTier] ?? []);
  const raised = flags.filter((f) => f.status === "flag" && required.has(f.flag));
  const reasons = raised.map((f) => `${FLAG_TITLES[f.flag]} (${f.flag.slice(0, 3)}): ${f.explanation}`);

  const domesticContent = passports.map((p) => ({
    passportId: p.id,
    ratio: p.domesticContentRatio,
    threshold: policy.domesticContentThreshold,
    meets: p.domesticContentRatio >= policy.domesticContentThreshold,
  }));
  const shortfalls = domesticContent.filter((d) => !d.meets);
  for (const s of shortfalls) {
    reasons.push(`Domestic content ${pct(s.ratio)} on passport ${s.passportId} is below the ${pct(s.threshold)} Buy American threshold.`);
  }
  if (unresolvedGaps.length) {
    reasons.push(
      `Required evidence still missing after ${Math.max(...unresolvedGaps.map((g) => g.attempts))} request(s): ${unresolvedGaps.map((g) => g.description).join("; ")}.`,
    );
  }

  const sanctions = identityChecks.find((c) => c.kind === "sanctions" && c.status === "flag");
  const hardStop = sanctions ? "Supplier matches a sanctions / denied-party list entry." : null;
  if (hardStop) reasons.unshift(hardStop);

  const issueCount = raised.length + (shortfalls.length ? 1 : 0) + (unresolvedGaps.length ? 1 : 0);
  let decision: PolicyDecision["decision"] = "approved";
  if (hardStop || issueCount >= policy.blockAtFlagCount) decision = "blocked";
  else if (issueCount >= policy.quarantineAtFlagCount) decision = "quarantined";

  if (decision === "approved") {
    reasons.push(
      `All ${required.size} ${riskTier}-tier red-flag checks passed.`,
      ...domesticContent.map((d) => `Domestic content ${pct(d.ratio)} meets the ${pct(d.threshold)} threshold.`),
    );
  }
  return { decision, reasons, issueCount, countedFlags: raised.map((f) => f.flag), domesticContent, hardStop };
}
