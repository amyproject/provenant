// Gap analysis: which evidence the buyer policy requires for the risk tier (BuyerPolicy.tierRequiredEvidence)
// and what is still missing.
import type { EvidenceDocument, EvidenceGap, EvidenceKind, Supplier } from "@/contracts";

export const EVIDENCE_DESCRIPTIONS: Record<EvidenceKind | "identity_field", string> = {
  facility_attestation: "Signed facility attestation for the site where the parts are made",
  certificate_of_conformance: "Certificate of conformance for the batch on this order",
  certificate_of_origin: "Certificate of origin listing each component's country of origin",
  test_report: "Third-party test report for this batch",
  bom: "Current bill of materials with sub-tier suppliers and countries of origin",
  other: "Supporting document",
  identity_field: "Company identifiers (UEI or EIN)",
};

/** Short labels for event summaries. */
export const EVIDENCE_LABELS: Record<EvidenceKind | "identity_field", string> = {
  facility_attestation: "facility attestation",
  certificate_of_conformance: "certificate of conformance",
  certificate_of_origin: "certificate of origin",
  test_report: "test report",
  bom: "sub-tier BOM",
  other: "supporting document",
  identity_field: "company identifiers",
};

export const gapId = (kind: EvidenceGap["kind"]) => `gap_${kind}`;

/**
 * Pure: merge the tier's requirements with what is already held. Existing gaps keep their attempt
 * counts; a document gap is resolved once a document of that kind is on file, the identity gap once the
 * supplier record has a UEI or EIN (e.g. supplied in a reply, see extractIdentifiers).
 */
export function computeGaps(input: {
  required: EvidenceKind[];
  supplier: Pick<Supplier, "uei" | "ein">;
  documents: Pick<EvidenceDocument, "kind">[];
  existing: EvidenceGap[];
  now: string;
}): EvidenceGap[] {
  const { supplier, documents, existing, now } = input;
  const required: EvidenceGap["kind"][] = [...input.required];
  const hasIdentifiers = Boolean(supplier.uei || supplier.ein);
  // Once opened, the identity gap stays on the case (resolved when the supplier record gains a UEI/EIN).
  if (!hasIdentifiers || existing.some((g) => g.kind === "identity_field")) required.push("identity_field");
  const held = new Set(documents.map((d) => d.kind));
  return required.map((kind) => {
    const prev = existing.find((g) => g.kind === kind);
    const satisfied = kind === "identity_field" ? hasIdentifiers : held.has(kind);
    const gap: EvidenceGap = prev ?? { id: gapId(kind), kind, description: EVIDENCE_DESCRIPTIONS[kind], attempts: 0 };
    return satisfied ? { ...gap, resolvedAt: gap.resolvedAt ?? now } : { ...gap, resolvedAt: undefined };
  });
}

export const openGaps = (gaps: EvidenceGap[]) => gaps.filter((g) => !g.resolvedAt);

/** UEI / EIN mentioned in a supplier reply or attachment text ("UEI: ABCD12345678", "EIN 12-3456789"). */
export function extractIdentifiers(text: string): { uei?: string; ein?: string } {
  const uei = /\bUEI(?:\s*(?:no\.?|number|#))?\s*[:#]?\s*([A-Z0-9]{12})\b/i.exec(text)?.[1]?.toUpperCase();
  const ein = /\bEIN(?:\s*(?:no\.?|number|#))?\s*[:#]?\s*(\d{2}-?\d{7})\b/i.exec(text)?.[1];
  return { ...(uei ? { uei } : {}), ...(ein ? { ein: ein.includes("-") ? ein : `${ein.slice(0, 2)}-${ein.slice(2)}` } : {}) };
}
