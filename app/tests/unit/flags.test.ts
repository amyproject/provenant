// B5 red-flag engine: one pure rule per flag. Positive + negative case each, with the spec's run mode.
import { describe, expect, it } from "vitest";
import type { FlagId, FlagResult } from "@/contracts";
import { ALL_FLAG_IDS, evaluateFlags, FLAG_RULES } from "@/server/flags";
import { check, ctx, doc, NOW, passport, po, supplier } from "../helpers/flagctx";

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

function run(flag: FlagId, c = ctx()) {
  const r = FLAG_RULES[flag](c);
  expect(r.flag).toBe(flag);
  expect(r.mode).toBe(MODE[flag]);
  expect(r.explanation.length).toBeGreaterThan(10);
  return r;
}

describe("engine", () => {
  it("has exactly the ten spec flags", () => {
    expect([...ALL_FLAG_IDS].sort()).toEqual(Object.keys(MODE).sort());
  });

  it("a clean context raises no flag on any rule", () => {
    const results = evaluateFlags(ctx(), ALL_FLAG_IDS);
    expect(results.filter((r) => r.status === "flag")).toEqual([]);
  });

  it("evaluates only requested flags, in canonical order", () => {
    const r = evaluateFlags(ctx(), ["F07_IMPERSONATOR_NAME", "F01_SIGNATURE_INVALID"]);
    expect(r.map((x) => x.flag)).toEqual(["F01_SIGNATURE_INVALID", "F07_IMPERSONATOR_NAME"]);
  });

  it("rules are deterministic", () => {
    const c = ctx();
    expect(evaluateFlags(c, ALL_FLAG_IDS)).toEqual(evaluateFlags(c, ALL_FLAG_IDS));
  });
});

describe("F01 signature invalid / expired / revoked (live)", () => {
  it("passes when every passport verifies", () => {
    expect(run("F01_SIGNATURE_INVALID").status).toBe("pass");
  });
  it.each(["bad_signature", "expired", "revoked", "unknown_issuer"] as const)("flags on %s", (reason) => {
    const c = ctx({ verifications: { pp_x1: { valid: false, revoked: reason === "revoked", reason } } });
    expect(run("F01_SIGNATURE_INVALID", c).status).toBe("flag");
  });
  it("flags an unsigned passport and a PO with no passports", () => {
    expect(run("F01_SIGNATURE_INVALID", ctx({ passports: [passport({ jwt: "" })] })).status).toBe("flag");
    expect(run("F01_SIGNATURE_INVALID", ctx({ passports: [] })).status).toBe("flag");
  });
  it("flags a passport that was never verified", () => {
    expect(run("F01_SIGNATURE_INVALID", ctx({ verifications: {} })).status).toBe("flag");
  });
});

describe("F02 tag clone (simulated)", () => {
  it("skips when no tag, passes on good challenge, flags on failed challenge", () => {
    expect(run("F02_TAG_CLONE").status).toBe("skip");
    expect(run("F02_TAG_CLONE", ctx({ tagChallenges: { "LOT-X1": { result: "pass", tagUid: "t1" } } })).status).toBe("pass");
    expect(run("F02_TAG_CLONE", ctx({ tagChallenges: { "LOT-X1": { result: "fail", tagUid: "t1" } } })).status).toBe("flag");
  });
});

describe("F03 reused test certificate (live)", () => {
  const original = supplier({ id: "sup_orig", legalName: "Original Labs Customer Inc." });
  const theirs = passport({ id: "pp_orig", supplierId: "sup_orig", serialOrBatch: "ORIG-1", issuedAt: "2026-01-01T00:00:00.000Z" });

  it("flags a certificate (same file hash) presented earlier by another supplier", () => {
    const c = ctx({ allPassports: [theirs, passport()], allSuppliers: [supplier(), original] });
    const r = run("F03_REUSED_TEST_CERT", c);
    expect(r.status).toBe("flag");
    expect(JSON.stringify(r.evidence)).toContain("pp_orig");
  });

  it("flags the same certificate number even with a different file hash", () => {
    const other = passport({ ...theirs, testCertificates: [{ certNumber: "TC-X-1", issuer: "Acme Labs", fileSha256: "9".repeat(64) }] });
    expect(run("F03_REUSED_TEST_CERT", ctx({ allPassports: [other, passport()], allSuppliers: [supplier(), original] })).status).toBe("flag");
  });

  it("does not flag the original holder when a copier presents it later", () => {
    const copier = passport({ ...theirs, issuedAt: "2026-10-01T00:00:00.000Z" });
    expect(run("F03_REUSED_TEST_CERT", ctx({ allPassports: [copier, passport()], allSuppliers: [supplier(), original] })).status).toBe("pass");
  });

  it("does not flag a new version of the same passport", () => {
    const v1 = passport({ id: "pp_v1" });
    const v2 = passport({ id: "pp_v2", version: 2, prevVersionId: "pp_v1" });
    expect(run("F03_REUSED_TEST_CERT", ctx({ passports: [v2], allPassports: [v1, v2], verifications: { pp_v2: { valid: true, revoked: false } } })).status).toBe("pass");
  });

  it("passes unique certificates, skips with none", () => {
    expect(run("F03_REUSED_TEST_CERT").status).toBe("pass");
    const bare = passport({ testCertificates: [] });
    expect(run("F03_REUSED_TEST_CERT", ctx({ passports: [bare], allPassports: [bare] })).status).toBe("skip");
  });
});

describe("F04 document metadata mismatch (seeded)", () => {
  const genuine = { issuer: "Acme Labs", certNumber: "TC-X-1" };
  it("passes when producer/template/number match the issuer's genuine samples", () => {
    const d = doc({ extracted: genuine, metadata: { producer: "AcmeLIMS 4.2", templateId: "ACME-TR-v3" } });
    expect(run("F04_DOC_METADATA_MISMATCH", ctx({ documents: [d] })).status).toBe("pass");
  });
  it("flags a document produced by the wrong tool", () => {
    const d = doc({ extracted: genuine, metadata: { producer: "Microsoft Word", templateId: "ACME-TR-v3" } });
    expect(run("F04_DOC_METADATA_MISMATCH", ctx({ documents: [d] })).status).toBe("flag");
  });
  it("flags a certificate number in the wrong format", () => {
    const d = doc({ extracted: { ...genuine, certNumber: "99-1" }, metadata: { producer: "AcmeLIMS 4.2", templateId: "ACME-TR-v3" } });
    expect(run("F04_DOC_METADATA_MISMATCH", ctx({ documents: [d] })).status).toBe("flag");
  });
  it("skips when no issuer sample exists", () => {
    const d = doc({ extracted: { issuer: "Unknown Lab" }, metadata: { producer: "x" } });
    expect(run("F04_DOC_METADATA_MISMATCH", ctx({ documents: [d] })).status).toBe("skip");
  });
});

describe("F05 imported finished goods (seeded)", () => {
  const shipments = [{ finishedGoods: true, description: "Servo actuators, assembled", originCountry: "CN", date: "2026-03-01" }];
  it("flags a US-production claim contradicted by finished-goods imports", () => {
    const c = ctx({ identityChecks: [check("shipping_history", "flag", { shipments })] });
    expect(run("F05_IMPORTED_FINISHED_GOODS", c).status).toBe("flag");
  });
  it("passes component-only imports, and when the supplier does not claim US production", () => {
    const comp = [{ ...shipments[0], finishedGoods: false, description: "Bearings" }];
    expect(run("F05_IMPORTED_FINISHED_GOODS", ctx({ identityChecks: [check("shipping_history", "pass", { shipments: comp })] })).status).toBe("pass");
    const c = ctx({ supplier: supplier({ claimedUsProduction: false }), identityChecks: [check("shipping_history", "flag", { shipments })] });
    expect(run("F05_IMPORTED_FINISHED_GOODS", c).status).toBe("pass");
  });
  it("skips without shipping data", () => {
    expect(run("F05_IMPORTED_FINISHED_GOODS", ctx({ identityChecks: [] })).status).toBe("skip");
  });
});

describe("F06 virtual office without facility evidence (live)", () => {
  const cmraSupplier = supplier({ address: { line1: "77 Commerce St #214", city: "Wilmington", state: "DE", zip: "19801", country: "US" } });
  const cmra = check("address_cmra", "flag", { address: "77 Commerce St #214, Wilmington DE", dpvCmra: "Y" });

  it("flags a CMRA address with no facility attestation", () => {
    expect(run("F06_VIRTUAL_OFFICE", ctx({ supplier: cmraSupplier, identityChecks: [cmra], documents: [] })).status).toBe("flag");
  });
  it("flags a CMRA address whose only attestation names the mailbox itself", () => {
    const att = doc({ kind: "facility_attestation", extracted: { facilityAddress: "77 Commerce St #214, Wilmington, DE 19801" } });
    expect(run("F06_VIRTUAL_OFFICE", ctx({ supplier: cmraSupplier, identityChecks: [cmra], documents: [att] })).status).toBe("flag");
  });
  it("passes a CMRA address with an attestation for a separate production site", () => {
    const att = doc({ kind: "facility_attestation", extracted: { facilityAddress: "12 Mill Rd, Newark, DE 19711" } });
    expect(run("F06_VIRTUAL_OFFICE", ctx({ supplier: cmraSupplier, identityChecks: [cmra], documents: [att] })).status).toBe("pass");
  });
  it("an attestation that names no facility address is not facility evidence", () => {
    const att = doc({ kind: "facility_attestation", extracted: {} });
    expect(run("F06_VIRTUAL_OFFICE", ctx({ supplier: cmraSupplier, identityChecks: [cmra], documents: [att] })).status).toBe("flag");
  });
  it("passes a normal commercial address; skips when unvalidated", () => {
    expect(run("F06_VIRTUAL_OFFICE").status).toBe("pass");
    expect(run("F06_VIRTUAL_OFFICE", ctx({ identityChecks: [] })).status).toBe("skip");
  });
});

describe("F07 impersonator name (live)", () => {
  const near = check("name_similarity", "flag", { bestMatch: { legalName: "Xylo Motion Inc.", similarity: 0.95, domain: "xylomotion.com" } });
  it("flags a near-copy name with a young domain", () => {
    const c = ctx({ identityChecks: [near, check("domain_age", "flag", { ageDays: 21 }), check("sam_registration", "pass", { registered: true })] });
    expect(run("F07_IMPERSONATOR_NAME", c).status).toBe("flag");
  });
  it("flags a near-copy name with no SAM filing history", () => {
    const c = ctx({ identityChecks: [near, check("domain_age", "pass", { ageDays: 4000 }), check("sam_registration", "flag", { registered: false })] });
    expect(run("F07_IMPERSONATOR_NAME", c).status).toBe("flag");
  });
  it("passes a similar name with an established domain and SAM history", () => {
    const c = ctx({ identityChecks: [near, check("domain_age", "pass", { ageDays: 4000 }), check("sam_registration", "pass", { registered: true })] });
    expect(run("F07_IMPERSONATOR_NAME", c).status).toBe("pass");
  });
  it("passes a dissimilar name even with a young domain", () => {
    const c = ctx({ identityChecks: [check("name_similarity", "pass", { bestMatch: null }), check("domain_age", "flag", { ageDays: 5 })] });
    expect(run("F07_IMPERSONATOR_NAME", c).status).toBe("pass");
  });
});

describe("F08 price / lead-time outlier (seeded)", () => {
  it("passes a normal quote", () => {
    expect(run("F08_PRICE_LEADTIME_OUTLIER", ctx({ po: po({ quotedUnitPriceUsd: 1050, quotedLeadTimeDays: 30 }) })).status).toBe("pass");
  });
  it("flags a price >= z threshold from the mean (too cheap)", () => {
    expect(run("F08_PRICE_LEADTIME_OUTLIER", ctx({ po: po({ quotedUnitPriceUsd: 400 }) })).status).toBe("flag");
  });
  it("flags an impossible lead time", () => {
    expect(run("F08_PRICE_LEADTIME_OUTLIER", ctx({ po: po({ quotedLeadTimeDays: 2 }) })).status).toBe("flag");
  });
  it("skips without a quote or baseline", () => {
    expect(run("F08_PRICE_LEADTIME_OUTLIER").status).toBe("skip");
    expect(run("F08_PRICE_LEADTIME_OUTLIER", ctx({ priceBaselines: [], po: po({ quotedUnitPriceUsd: 1 }) })).status).toBe("skip");
  });
});

describe("F09 bank change without re-auth (simulated)", () => {
  it("flags an unauthenticated change, passes a re-authenticated one or none", () => {
    expect(run("F09_BANK_CHANGE_NO_REAUTH", ctx({ bankChanges: [{ supplierId: "sup_x", at: NOW, reauthenticated: false }] })).status).toBe("flag");
    expect(run("F09_BANK_CHANGE_NO_REAUTH", ctx({ bankChanges: [{ supplierId: "sup_x", at: NOW, reauthenticated: true }] })).status).toBe("pass");
    expect(run("F09_BANK_CHANGE_NO_REAUTH").status).toBe("pass");
  });
  it("ignores other suppliers' bank changes", () => {
    expect(run("F09_BANK_CHANGE_NO_REAUTH", ctx({ bankChanges: [{ supplierId: "sup_other", at: NOW, reauthenticated: false }] })).status).toBe("pass");
  });
});

describe("F10 undisclosed sub-tier change (seeded)", () => {
  const v1 = passport({ id: "pp_v1" });
  const v2 = passport({
    id: "pp_v2",
    version: 2,
    prevVersionId: "pp_v1",
    components: [v1.components[0], { name: "Reducer", supplierName: "Shenzhen Drive Co", countryOfOrigin: "CN", costUsd: 30 }],
  });
  const base = { passports: [v2], previousVersions: { pp_v2: v1 }, verifications: { pp_v2: { valid: true, revoked: false } } };

  it("flags a component moved to a restricted country without disclosure", () => {
    const r = run("F10_UNDISCLOSED_SUBTIER_CHANGE", ctx({ ...base, documents: [] }));
    expect(r.status).toBe("flag");
    expect(JSON.stringify(r.evidence)).toContain("CN");
  });
  it("passes when the change was disclosed in a document", () => {
    const d = doc({ kind: "bom", extracted: { disclosedSubtierChanges: [{ component: "Reducer", toCountry: "CN" }] } });
    expect(run("F10_UNDISCLOSED_SUBTIER_CHANGE", ctx({ ...base, documents: [d] })).status).toBe("pass");
  });
  it("passes a move to a non-restricted country", () => {
    const v2ok = passport({ ...v2, components: [v1.components[0], { name: "Reducer", supplierName: "Munich Gears", countryOfOrigin: "DE", costUsd: 30 }] });
    expect(run("F10_UNDISCLOSED_SUBTIER_CHANGE", ctx({ ...base, passports: [v2ok], previousVersions: { pp_v2: v1 } })).status).toBe("pass");
  });
  it("uses the policy's restricted-country list", () => {
    const c = ctx({ ...base, documents: [], policy: { ...ctx().policy, restrictedCountries: ["RU"] } });
    expect(run("F10_UNDISCLOSED_SUBTIER_CHANGE", c).status).toBe("pass");
  });
  it("skips a first-issue passport", () => {
    expect(run("F10_UNDISCLOSED_SUBTIER_CHANGE").status).toBe("skip");
  });
});

describe("F06 mailbox matching is format-insensitive", () => {
  it("an attestation naming the same mailbox as 'Suite 214' instead of '#214' still flags", () => {
    const s = supplier({ address: { line1: "77 Commerce St #214", city: "Wilmington", state: "DE", zip: "19801", country: "US" } });
    const att = doc({ kind: "facility_attestation", extracted: { facilityAddress: "77 Commerce Street, Suite 214, Wilmington, DE 19801" } });
    const c = ctx({ supplier: s, identityChecks: [check("address_cmra", "flag", { dpvCmra: "Y" })], documents: [att] });
    expect(run("F06_VIRTUAL_OFFICE", c).status).toBe("flag");
  });
});
