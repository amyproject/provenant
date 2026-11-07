// B6 policy gate: 0 issues approve, 1 quarantine, >=2 block; domestic content; tier flag selection.
import { describe, expect, it } from "vitest";
import type { FlagId, FlagResult } from "@/contracts";
import { applyPolicy } from "@/server/policy";
import { check, passport, policy } from "../helpers/flagctx";

const f = (flag: FlagId, status: FlagResult["status"] = "flag"): FlagResult => ({
  flag,
  status,
  mode: "live",
  evidence: {},
  explanation: `${flag} explanation`,
});
const pass = (flag: FlagId) => f(flag, "pass");
const base = { policy: policy(), riskTier: "high" as const, passports: [passport()], identityChecks: [] };

describe("flag count thresholds (spec: 1 flag quarantine, >=2 block)", () => {
  it("0 flags -> approved", () => {
    const r = applyPolicy({ ...base, flags: [pass("F01_SIGNATURE_INVALID"), pass("F10_UNDISCLOSED_SUBTIER_CHANGE")] });
    expect(r.decision).toBe("approved");
    expect(r.issueCount).toBe(0);
  });
  it("1 flag -> quarantined, with the flag in reasons", () => {
    const r = applyPolicy({ ...base, flags: [f("F10_UNDISCLOSED_SUBTIER_CHANGE"), pass("F01_SIGNATURE_INVALID")] });
    expect(r.decision).toBe("quarantined");
    expect(r.countedFlags).toEqual(["F10_UNDISCLOSED_SUBTIER_CHANGE"]);
    expect(r.reasons.join(" ")).toContain("F10_UNDISCLOSED_SUBTIER_CHANGE explanation");
  });
  it("2 flags -> blocked; 3 flags -> blocked", () => {
    expect(applyPolicy({ ...base, flags: [f("F03_REUSED_TEST_CERT"), f("F06_VIRTUAL_OFFICE")] }).decision).toBe("blocked");
    const r = applyPolicy({ ...base, flags: [f("F03_REUSED_TEST_CERT"), f("F06_VIRTUAL_OFFICE"), f("F07_IMPERSONATOR_NAME")] });
    expect(r.decision).toBe("blocked");
    expect(r.countedFlags.sort()).toEqual(["F03_REUSED_TEST_CERT", "F06_VIRTUAL_OFFICE", "F07_IMPERSONATOR_NAME"]);
  });
  it("skipped rules do not count", () => {
    expect(applyPolicy({ ...base, flags: [f("F02_TAG_CLONE", "skip"), f("F10_UNDISCLOSED_SUBTIER_CHANGE", "skip")] }).decision).toBe("approved");
  });
  it("thresholds come from the policy", () => {
    const strict = policy({ quarantineAtFlagCount: 1, blockAtFlagCount: 1 });
    expect(applyPolicy({ ...base, policy: strict, flags: [f("F06_VIRTUAL_OFFICE")] }).decision).toBe("blocked");
  });
});

describe("tier flag selection", () => {
  it("flags outside the PO's tier do not count", () => {
    // F10 is high-only in the QA policy.
    const r = applyPolicy({ ...base, riskTier: "low", flags: [f("F10_UNDISCLOSED_SUBTIER_CHANGE")] });
    expect(r.decision).toBe("approved");
    expect(r.countedFlags).toEqual([]);
  });
  it("the same flag counts at high tier", () => {
    expect(applyPolicy({ ...base, riskTier: "high", flags: [f("F10_UNDISCLOSED_SUBTIER_CHANGE")] }).decision).toBe("quarantined");
  });
  it("low-tier flags count at every tier", () => {
    for (const riskTier of ["low", "medium", "high"] as const)
      expect(applyPolicy({ ...base, riskTier, flags: [f("F01_SIGNATURE_INVALID")] }).decision).toBe("quarantined");
  });
});

describe("domestic content (Buy American)", () => {
  it("ratio at the threshold meets it", () => {
    const r = applyPolicy({ ...base, passports: [passport({ domesticContentRatio: 0.65 })], flags: [] });
    expect(r.decision).toBe("approved");
    expect(r.domesticContent[0].meets).toBe(true);
  });
  it("ratio below the threshold counts as an issue -> quarantined, with a reason", () => {
    const r = applyPolicy({ ...base, passports: [passport({ domesticContentRatio: 0.5 })], flags: [] });
    expect(r.decision).toBe("quarantined");
    expect(r.domesticContent[0].meets).toBe(false);
    expect(r.reasons.join(" ").toLowerCase()).toContain("domestic content");
  });
  it("shortfall + one flag -> blocked", () => {
    const r = applyPolicy({ ...base, passports: [passport({ domesticContentRatio: 0.5 })], flags: [f("F06_VIRTUAL_OFFICE")] });
    expect(r.decision).toBe("blocked");
  });
  it("2029 threshold (0.75) is configurable", () => {
    const r = applyPolicy({ ...base, policy: policy({ domesticContentThreshold: 0.75 }), passports: [passport({ domesticContentRatio: 0.7 })], flags: [] });
    expect(r.decision).toBe("quarantined");
  });
});

describe("hard stops and missing evidence", () => {
  it("a sanctions hit blocks regardless of flag count", () => {
    const r = applyPolicy({ ...base, flags: [], identityChecks: [check("sanctions", "flag", { match: "x" })] });
    expect(r.decision).toBe("blocked");
    expect(r.hardStop).toBeTruthy();
  });
  it("unresolved evidence gaps count as an issue", () => {
    const r = applyPolicy({
      ...base,
      flags: [],
      unresolvedGaps: [{ id: "g1", kind: "test_report", description: "Test report", attempts: 3 }],
    });
    expect(r.decision).toBe("quarantined");
    expect(r.reasons.join(" ")).toContain("Test report");
  });
});
