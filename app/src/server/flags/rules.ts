// The ten red-flag rules from the spec. One pure, deterministic function per flag:
// same context in, same result out. AI never decides here — it only rewrites `explanation` later.
// `mode` is the spec's Hackathon column: live logic, live logic on seeded data, or simulated.
import type { EvidenceDocument, PartPassport } from "@/contracts";
import { nameSimilarity, sameStreetAddress, strictCompanyKey } from "../checks/names";
import { YOUNG_DOMAIN_DAYS } from "../checks/domain";
import { flagResult, type FlagContext, type FlagRule } from "./types";

const check = (ctx: FlagContext, kind: string) => ctx.identityChecks.find((c) => c.kind === kind);
const ev = (c: { evidence: Record<string, unknown> } | undefined) => (c?.evidence ?? {}) as Record<string, unknown>;

/** F01 — Signature fails, or credential unsigned / expired / revoked. Live. */
export const f01SignatureInvalid: FlagRule = (ctx) => {
  const failures = ctx.passports
    .map((p) => {
      const v = ctx.verifications[p.id];
      if (!p.jwt) return { passportId: p.id, reason: "unsigned" };
      if (!v) return { passportId: p.id, reason: "not_verified" };
      return v.valid ? null : { passportId: p.id, reason: v.reason ?? "invalid" };
    })
    .filter((x): x is { passportId: string; reason: string } => x !== null);
  if (!ctx.passports.length) {
    return flagResult("F01_SIGNATURE_INVALID", "live", "flag", { passports: 0 }, "The order references no signed part passport, so origin claims are unsigned.");
  }
  return failures.length
    ? flagResult(
        "F01_SIGNATURE_INVALID",
        "live",
        "flag",
        { failures, checked: ctx.passports.length },
        `Passport verification failed (${failures.map((f) => `${f.passportId}: ${f.reason.replace(/_/g, " ")}`).join("; ")}). The claims cannot be trusted as issued by the supplier.`,
      )
    : flagResult(
        "F01_SIGNATURE_INVALID",
        "live",
        "pass",
        { checked: ctx.passports.length, issuer: ctx.supplier.legalName },
        `All ${ctx.passports.length} passport signature(s) verify against ${ctx.supplier.legalName}'s Ed25519 key and none are expired or revoked.`,
      );
};

/** F02 — Serial exists but NFC challenge-response fails (clone). Simulated. */
export const f02TagClone: FlagRule = (ctx) => {
  const results = ctx.passports.map((p) => ({ serial: p.serialOrBatch, ...(ctx.tagChallenges[p.serialOrBatch] ?? { result: "no_tag", tagUid: null }) }));
  const failed = results.filter((r) => r.result === "fail");
  if (failed.length) {
    return flagResult("F02_TAG_CLONE", "simulated", "flag", { results }, `Simulated NFC challenge-response failed for ${failed.map((f) => f.serial).join(", ")}: the tag answered with the wrong key, which indicates a cloned tag.`);
  }
  if (results.every((r) => r.result === "no_tag")) {
    return flagResult("F02_TAG_CLONE", "simulated", "skip", { results }, "No secure NFC tag is registered for these serials, so clone detection was not possible (QR codes can be copied).");
  }
  return flagResult("F02_TAG_CLONE", "simulated", "pass", { results }, "Simulated NFC challenge-response succeeded for every tagged serial.");
};

function lineageRoot(p: PartPassport, all: PartPassport[]): string {
  let cur = p;
  const seen = new Set<string>();
  while (cur.prevVersionId && !seen.has(cur.id)) {
    seen.add(cur.id);
    const prev = all.find((x) => x.id === cur.prevVersionId);
    if (!prev) return cur.prevVersionId;
    cur = prev;
  }
  return cur.id;
}

/** F03 — Same test certificate used for unrelated batches (file hash or certificate number). Live. */
export const f03ReusedTestCert: FlagRule = (ctx) => {
  const findings: Record<string, unknown>[] = [];
  const notes: Record<string, unknown>[] = [];
  for (const p of ctx.passports) {
    const root = lineageRoot(p, ctx.allPassports);
    for (const cert of p.testCertificates) {
      const same = (c: { certNumber: string; fileSha256: string }) =>
        (cert.fileSha256 && c.fileSha256 === cert.fileSha256) || (cert.certNumber && c.certNumber === cert.certNumber);
      const ownerDoc = ctx.documents.find((d) => d.sha256 === cert.fileSha256);
      const certClient = String(ownerDoc?.extracted.subjectCompany ?? "");
      // This supplier's first presentation of the certificate (a new passport version keeps the original date).
      const ourFirstUse = ctx.allPassports
        .filter((x) => x.supplierId === p.supplierId && x.model === p.model && x.testCertificates.some(same))
        .reduce((min, x) => (x.issuedAt < min ? x.issuedAt : min), p.issuedAt);
      for (const other of ctx.allPassports) {
        if (other.id === p.id || lineageRoot(other, ctx.allPassports) === root) continue;
        if (!other.testCertificates.some(same)) continue;
        const differentSupplier = other.supplierId !== p.supplierId;
        const differentModel = other.model !== p.model;
        if (!differentSupplier && !differentModel) continue;
        const otherSupplier = ctx.allSuppliers.find((s) => s.id === other.supplierId);
        const presentedEarlier = other.issuedAt < ourFirstUse;
        // Exact entity match (suffix kept): a look-alike name must not inherit the real company's certificate.
        const certNamesOther = Boolean(certClient && otherSupplier) && strictCompanyKey(certClient) === strictCompanyKey(otherSupplier!.legalName);
        const usage = {
          certNumber: cert.certNumber,
          fileSha256: cert.fileSha256,
          thisPassport: { id: p.id, serialOrBatch: p.serialOrBatch, issuedAt: p.issuedAt },
          otherPassport: { id: other.id, supplier: otherSupplier?.legalName ?? other.supplierId, serialOrBatch: other.serialOrBatch, model: other.model, issuedAt: other.issuedAt },
          certificateClient: certClient || null,
        };
        // The earlier presenter (or the company named on the certificate) owns it; the later one is reusing it.
        if (presentedEarlier || certNamesOther || (!differentSupplier && differentModel)) findings.push(usage);
        else notes.push({ ...usage, note: "certificate later presented by another party; this supplier is the original holder" });
      }
    }
  }
  if (findings.length) {
    const f = findings[0] as { certNumber: string; otherPassport: { supplier: string; serialOrBatch: string } };
    return flagResult(
      "F03_REUSED_TEST_CERT",
      "live",
      "flag",
      { reuses: findings, ...(notes.length ? { notes } : {}) },
      `Test certificate ${f.certNumber} (identical file hash) was already presented by ${f.otherPassport.supplier} for batch ${f.otherPassport.serialOrBatch}. A test report covers one batch of one product, so reusing it here is not evidence for this order.`,
    );
  }
  const certCount = ctx.passports.reduce((n, p) => n + p.testCertificates.length, 0);
  if (!certCount) return flagResult("F03_REUSED_TEST_CERT", "live", "skip", {}, "No test certificates are attached to the passports on this order.");
  return flagResult(
    "F03_REUSED_TEST_CERT",
    "live",
    "pass",
    { certificatesChecked: certCount, ...(notes.length ? { notes } : {}) },
    notes.length
      ? `This supplier's test certificate is unique to its batch. Note: the same certificate was later presented by another party, which is checked on that party's orders.`
      : `All ${certCount} test certificate(s) are unique to this supplier's batch (no matching file hash or certificate number elsewhere).`,
  );
};

const THIRD_PARTY_KINDS = new Set(["test_report", "certificate_of_conformance", "certificate_of_origin"]);

/** F04 — Document metadata / format does not match genuine documents from that issuer. Seeded. */
export const f04DocMetadataMismatch: FlagRule = (ctx) => {
  const compared: Record<string, unknown>[] = [];
  const mismatches: Record<string, unknown>[] = [];
  for (const d of ctx.documents) {
    if (!THIRD_PARTY_KINDS.has(d.kind)) continue;
    const issuer = String(d.extracted.issuer ?? "");
    const sample = ctx.issuerSamples[issuer];
    if (!sample) continue;
    const producer = String(d.metadata.producer ?? "");
    const templateId = String(d.metadata.templateId ?? "");
    const certNumber = String(d.extracted.certNumber ?? "");
    const problems = [
      !sample.producers.includes(producer) && `producer "${producer || "missing"}" not used by ${issuer}`,
      sample.templateIds.length && !sample.templateIds.includes(templateId) && `template "${templateId || "missing"}" unknown for ${issuer}`,
      sample.certNumberPattern && certNumber && !new RegExp(sample.certNumberPattern).test(certNumber) && `certificate number ${certNumber} does not follow ${issuer}'s format`,
    ].filter(Boolean) as string[];
    const row = { documentId: d.id, filename: d.filename, issuer, producer, templateId };
    compared.push(row);
    if (problems.length) mismatches.push({ ...row, problems });
  }
  if (mismatches.length) {
    const m = mismatches[0] as { filename: string; problems: string[] };
    return flagResult("F04_DOC_METADATA_MISMATCH", "seeded", "flag", { mismatches, compared: compared.length }, `${m.filename} does not look like a genuine document from its stated issuer: ${m.problems.join("; ")}.`);
  }
  if (!compared.length) {
    return flagResult("F04_DOC_METADATA_MISMATCH", "seeded", "skip", {}, "No documents from issuers with known genuine samples were available to compare.");
  }
  return flagResult("F04_DOC_METADATA_MISMATCH", "seeded", "pass", { compared }, `Metadata of ${compared.length} third-party document(s) matches known genuine samples from the issuer (producer, template, numbering).`);
};

/** F05 — Claims US production but shipping records show imported finished goods. Seeded. */
export const f05ImportedFinishedGoods: FlagRule = (ctx) => {
  const c = check(ctx, "shipping_history");
  const e = ev(c);
  if (!c || c.status === "skip" || c.status === "error") {
    return flagResult("F05_IMPORTED_FINISHED_GOODS", "seeded", "skip", { reason: e.reason ?? e.error ?? "no shipping data" }, "No bill-of-lading data was available for this supplier (sea freight only; absence is not proof).");
  }
  const shipments = (e.shipments ?? []) as { finishedGoods: boolean; description: string; originCountry: string; date: string }[];
  const finished = shipments.filter((s) => s.finishedGoods);
  if (ctx.supplier.claimedUsProduction && finished.length) {
    return flagResult("F05_IMPORTED_FINISHED_GOODS", "seeded", "flag", { finished, claimedUsProduction: true }, `The supplier claims US production, but customs records show ${finished.length} import(s) of finished goods (e.g. "${finished[0].description}" from ${finished[0].originCountry} on ${finished[0].date}).`);
  }
  return flagResult(
    "F05_IMPORTED_FINISHED_GOODS",
    "seeded",
    "pass",
    { shipmentCount: shipments.length, origins: e.origins ?? [] },
    shipments.length
      ? `${shipments.length} import record(s) found, all components or raw material rather than finished goods, consistent with domestic production.`
      : "No import records of finished goods (sea freight data only).",
  );
};

/** F06 — Address is a virtual office (USPS CMRA) and no facility evidence exists. Live. */
export const f06VirtualOffice: FlagRule = (ctx) => {
  const c = check(ctx, "address_cmra");
  if (!c || c.status === "skip" || c.status === "error") {
    return flagResult("F06_VIRTUAL_OFFICE", "live", "skip", {}, "Address could not be validated against USPS data.");
  }
  const cmra = c.status === "flag";
  const attestations = ctx.documents.filter((d) => d.kind === "facility_attestation");
  // An attestation counts as facility evidence only if it names a site, and (for a CMRA) not the mailbox itself.
  const credible = attestations.filter((d) => {
    const site = typeof d.extracted.facilityAddress === "string" ? d.extracted.facilityAddress.trim() : "";
    return site.length > 0 && (!cmra || !sameStreetAddress(ctx.supplier.address.line1, site));
  });
  const evidence = {
    address: ev(c).address,
    dpvCmra: ev(c).dpvCmra,
    facilityAttestations: attestations.length,
    credibleFacilityEvidence: credible.length,
    ...(attestations.length ? { attestedSites: attestations.map((d) => d.extracted.facilityAddress ?? null) } : {}),
  };
  if (cmra && !credible.length) {
    return flagResult(
      "F06_VIRTUAL_OFFICE",
      "live",
      "flag",
      evidence,
      `The registered address (${ev(c).address}) is a USPS Commercial Mail Receiving Agency, i.e. a mailbox or virtual office, and ` +
        (attestations.length
          ? "no facility statement provided names a production site other than that mailbox."
          : "the supplier has provided no facility attestation showing where parts are actually made."),
    );
  }
  return flagResult(
    "F06_VIRTUAL_OFFICE",
    "live",
    "pass",
    evidence,
    cmra
      ? "The address is a mail-receiving agency, but a signed facility attestation identifies a separate production site."
      : `The address is a deliverable commercial location, not a CMRA${attestations.length ? ", and a signed facility attestation is on file" : ""}.`,
  );
};

/** F07 — Near copy of a known supplier's name + recently created website + no filing history. Live. */
export const f07ImpersonatorName: FlagRule = (ctx) => {
  const sim = check(ctx, "name_similarity");
  const dom = check(ctx, "domain_age");
  const sam = check(ctx, "sam_registration");
  const best = ev(sim).bestMatch as { legalName: string; similarity: number; domain: string } | null | undefined;
  const nearCopy = sim?.status === "flag" && Boolean(best);
  const ageDays = typeof ev(dom).ageDays === "number" ? (ev(dom).ageDays as number) : null;
  const youngDomain = ageDays !== null && ageDays < YOUNG_DOMAIN_DAYS;
  const noFilingHistory = ev(sam).registered === false;
  const evidence = { nearCopyOf: best ?? null, domainAgeDays: ageDays, samRegistered: !noFilingHistory };
  if (nearCopy && (youngDomain || noFilingHistory)) {
    const why = [youngDomain && `its website was registered only ${ageDays} days ago`, noFilingHistory && "it has no SAM.gov registration or filing history"].filter(Boolean).join(" and ");
    return flagResult("F07_IMPERSONATOR_NAME", "live", "flag", evidence, `"${ctx.supplier.legalName}" is a ${Math.round(best!.similarity * 100)}% match to the established supplier "${best!.legalName}" (${best!.domain}), yet ${why}. This is the pattern of an impersonator trading on a real supplier's name.`);
  }
  return flagResult(
    "F07_IMPERSONATOR_NAME",
    "live",
    "pass",
    evidence,
    nearCopy
      ? `Name resembles "${best!.legalName}", but the supplier has an established website and federal registration history.`
      : "The supplier name is not a near copy of any enrolled supplier.",
  );
};

/** F08 — Price or lead time impossible vs fleet / market baseline. Seeded. */
export const f08PriceLeadtimeOutlier: FlagRule = (ctx) => {
  const model = ctx.passports[0]?.model;
  const base = ctx.priceBaselines.find((b) => model && b.models.includes(model));
  const { quotedUnitPriceUsd: price, quotedLeadTimeDays: lead } = ctx.po;
  if (!base || (price === undefined && lead === undefined)) {
    return flagResult("F08_PRICE_LEADTIME_OUTLIER", "seeded", "skip", { model }, "No price/lead-time baseline for this part category, or no quote on the order.");
  }
  const z = price !== undefined ? (price - base.unitPriceMeanUsd) / base.unitPriceStdUsd : null;
  const priceOutlier = z !== null && Math.abs(z) >= ctx.priceZThreshold;
  const leadImpossible = lead !== undefined && lead < base.minFeasibleLeadTimeDays;
  const evidence = { category: base.category, quotedUnitPriceUsd: price, baselineMeanUsd: base.unitPriceMeanUsd, zScore: z === null ? null : Math.round(z * 100) / 100, quotedLeadTimeDays: lead, minFeasibleLeadTimeDays: base.minFeasibleLeadTimeDays, sampleSize: base.sampleSize };
  if (priceOutlier || leadImpossible) {
    const parts = [
      priceOutlier && `unit price $${price} is ${Math.abs(z!).toFixed(1)} standard deviations from the $${base.unitPriceMeanUsd} fleet average`,
      leadImpossible && `a ${lead}-day lead time is below the ${base.minFeasibleLeadTimeDays}-day minimum seen across ${base.sampleSize} comparable orders`,
    ].filter(Boolean);
    return flagResult("F08_PRICE_LEADTIME_OUTLIER", "seeded", "flag", evidence, `Quote is implausible: ${parts.join(" and ")}.`);
  }
  return flagResult("F08_PRICE_LEADTIME_OUTLIER", "seeded", "pass", evidence, `Quote is within normal range for ${base.category.replace(/_/g, " ")}s (price z-score ${evidence.zScore ?? "n/a"}, lead time ${lead ?? "n/a"} days).`);
};

/** F09 — Bank details changed without re-authentication. Simulated. */
export const f09BankChangeNoReauth: FlagRule = (ctx) => {
  const changes = ctx.bankChanges.filter((b) => b.supplierId === ctx.supplier.id);
  const unauth = changes.filter((b) => !b.reauthenticated);
  if (unauth.length) {
    return flagResult("F09_BANK_CHANGE_NO_REAUTH", "simulated", "flag", { changes: unauth }, `Bank details changed on ${unauth[0].at.slice(0, 10)} without a fresh signature from the supplier's enrolled key, the classic payment-diversion pattern.`);
  }
  return flagResult("F09_BANK_CHANGE_NO_REAUTH", "simulated", "pass", { changes: changes.length }, changes.length ? "Bank detail changes were re-authenticated with the supplier's signing key." : "No bank detail changes since enrollment.");
};

/** F10 — Sub-tier supplier moved to a restricted country without disclosure (passport version diff). Seeded. */
export const f10UndisclosedSubtierChange: FlagRule = (ctx) => {
  const restricted = new Set(ctx.policy.restrictedCountries);
  const disclosures = ctx.documents.flatMap((d: EvidenceDocument) =>
    ((d.extracted.disclosedSubtierChanges ?? []) as { component: string; toCountry?: string }[]).map((x) => ({ ...x, documentId: d.id })),
  );
  const changes: Record<string, unknown>[] = [];
  let compared = 0;
  for (const p of ctx.passports) {
    const prev = ctx.previousVersions[p.id];
    if (!prev) continue;
    compared++;
    for (const c of p.components) {
      const before = prev.components.find((x) => x.name === c.name || (x.partNumber && x.partNumber === c.partNumber));
      if (!before || before.countryOfOrigin === c.countryOfOrigin || !restricted.has(c.countryOfOrigin)) continue;
      const disclosed = disclosures.some((d) => nameSimilarity(d.component, c.name) >= 0.8 && (!d.toCountry || d.toCountry === c.countryOfOrigin));
      changes.push({
        component: c.name,
        from: { supplierName: before.supplierName, countryOfOrigin: before.countryOfOrigin, version: prev.version },
        to: { supplierName: c.supplierName, countryOfOrigin: c.countryOfOrigin, version: p.version },
        disclosed,
      });
    }
  }
  const undisclosed = changes.filter((c) => !c.disclosed) as { component: string; from: { supplierName: string; countryOfOrigin: string; version: number }; to: { supplierName: string; countryOfOrigin: string; version: number } }[];
  if (undisclosed.length) {
    const u = undisclosed[0];
    return flagResult("F10_UNDISCLOSED_SUBTIER_CHANGE", "seeded", "flag", { changes, restrictedCountries: [...restricted] }, `Between passport v${u.from.version} and v${u.to.version}, the ${u.component.toLowerCase()} moved from ${u.from.supplierName} (${u.from.countryOfOrigin}) to ${u.to.supplierName} (${u.to.countryOfOrigin}), a restricted country under the buyer's policy. The supplier's documents for this batch do not disclose the change.`);
  }
  if (!compared) {
    return flagResult("F10_UNDISCLOSED_SUBTIER_CHANGE", "seeded", "skip", {}, "No earlier passport version to compare against (first issue).");
  }
  return flagResult("F10_UNDISCLOSED_SUBTIER_CHANGE", "seeded", "pass", { changes }, changes.length ? "Sub-tier origin changes to restricted countries were disclosed by the supplier." : "No component moved to a restricted country between passport versions.");
};
