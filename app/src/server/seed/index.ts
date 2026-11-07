// Demo seed: fictional suppliers A/B/C, buyer policy, signed passports and held evidence.
// Everything is loaded from app/data/seed/*.json and pushed through the same services the API uses
// (enrollment runs real Loop 1 checks; passports are signed with each supplier's key).
import { DEMO, type BuyerPolicy, type CreatePassportRequest, type EnrollSupplierRequest, type EvidenceDocument, type PartPassport, type RiskTier } from "@/contracts";
import passportsJson from "../../../data/seed/passports.json";
import policyJson from "../../../data/seed/policy.json";
import suppliersJson from "../../../data/seed/suppliers.json";
import { getRepo } from "../repo";
import { buildPassport } from "../services/passports";
import { enrollSupplier } from "../services/suppliers";
import { nowIso } from "../util/ids";
import { DEFAULT_POLICY_ID, DEMO_META_ID } from "./constants";
import { seedDocument, seedDocuments } from "./documents";

export { DEFAULT_POLICY_ID, DEMO_META_ID } from "./constants";
export { seedDocuments, seedDocument } from "./documents";

export type { DemoLabel } from "@/contracts";
import type { DemoLabel } from "@/contracts";

export interface DemoPurchaseOrder {
  label: DemoLabel;
  supplierId: string;
  passportIds: string[];
  riskTier: RiskTier;
  amountUsd: number;
  quotedUnitPriceUsd?: number;
  quotedLeadTimeDays?: number;
}

export const DEMO_PURCHASE_ORDERS = passportsJson.purchaseOrders as DemoPurchaseOrder[];
export const SEED_POLICY = policyJson as BuyerPolicy;

/** "D:20260912103000Z" -> ISO timestamp. */
function pdfDateToIso(d: string): string {
  const m = /^D:(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(d);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.000Z` : nowIso();
}

/** Wipe the store and load the demo world. Deterministic: same seed -> same passports and JWTs. */
export async function resetDemo(): Promise<void> {
  const repo = getRepo();
  await repo.clear();
  await repo.policies.put(SEED_POLICY);

  const labels = {} as Record<DemoLabel, string>;
  for (const { label, supplier } of suppliersJson.suppliers) {
    // Identity fields come from the shared contract so backend seed and frontend mocks cannot drift.
    const demo = DEMO[label as DemoLabel];
    const { id: _id, createdAt, ...rest } = supplier;
    void _id;
    const req: EnrollSupplierRequest = { ...rest, legalName: demo.legalName, domain: demo.domain, contactEmail: demo.contactEmail };
    await enrollSupplier(req, { id: demo.supplierId, createdAt });
    labels[label as DemoLabel] = demo.supplierId;
  }

  for (const d of seedDocuments().filter((x) => x.held)) {
    const doc: EvidenceDocument = {
      id: d.id,
      supplierId: d.supplierId,
      kind: d.kind,
      filename: d.filename,
      sha256: d.sha256,
      extracted: d.extracted,
      metadata: { ...d.metadata, isPdf: true, byteLength: d.bytes.length, contentType: "application/pdf", extractedBy: "fixture" },
      receivedVia: "seed",
      receivedAt: pdfDateToIso(String(d.metadata.creationDate)),
    };
    await repo.documents.put(doc);
  }

  const passportLabels = {} as Record<DemoLabel, string>;
  const pendingPassports: Record<string, PartPassport> = {};
  for (const p of passportsJson.passports) {
    const req: CreatePassportRequest = {
      supplierId: p.supplierId,
      serialOrBatch: p.serialOrBatch,
      model: p.model,
      spec: p.spec,
      components: p.components,
      testCertificateDocumentIds: p.testCertificateDocs,
      firmwareVersion: p.firmwareVersion,
      ...("prevVersionId" in p && p.prevVersionId ? { prevVersionId: p.prevVersionId } : {}),
    };
    const testCertificates = p.testCertificateDocs.map((docId) => {
      const d = seedDocument(docId);
      return { certNumber: String(d.extracted.certNumber), issuer: String(d.extracted.issuer), fileSha256: d.sha256 };
    });
    const passport = await buildPassport(req, { id: p.id, issuedAt: p.issuedAt, testCertificates });
    if (p.delivery === "reply") pendingPassports[p.id] = passport;
    else await repo.passports.put(passport);
    if (p.label === "A" || p.label === "B" || p.label === "C") passportLabels[p.label] = p.id;
  }

  await repo.meta.put({
    id: DEMO_META_ID,
    seededAt: nowIso(),
    suppliers: labels,
    passports: passportLabels,
    policyId: DEFAULT_POLICY_ID,
    pendingPassports,
  });
}

const g = globalThis as unknown as { __provenantSeeding?: Promise<void> | null };

/** Seed on first use (empty store). Concurrent callers share one seeding run. */
export async function ensureSeeded(): Promise<void> {
  if (await getRepo().meta.get(DEMO_META_ID)) return;
  g.__provenantSeeding ??= resetDemo().finally(() => {
    g.__provenantSeeding = null;
  });
  await g.__provenantSeeding;
}
