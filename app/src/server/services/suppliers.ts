import type {
  EnrollSupplierRequest,
  EnrollSupplierResponse,
  EvidenceDocument,
  IdentityCheckResult,
  SupplierDetailResponse,
  SupplierSummary,
  Supplier,
  UploadDocumentRequest,
} from "@/contracts";
import { passesEnrollment, runIdentityChecks } from "../checks";
import { signSupplierCredential } from "../crypto/vc";
import { notFound } from "../errors";
import { extractDocument } from "../extract";
import { getRepo, type Repo } from "../repo";
import { newId, nowIso } from "../util/ids";
import { getPassport } from "./passports";

/** Run Loop 1 checks against enrolled suppliers and store them as the supplier's latest results. */
export async function screenSupplier(repo: Repo, supplier: Supplier, now = nowIso()): Promise<IdentityCheckResult[]> {
  const knownSuppliers = (await repo.suppliers.list({ status: "enrolled" })).filter((s) => s.id !== supplier.id);
  const results = await runIdentityChecks({ supplier, knownSuppliers, now });
  await repo.identityChecks.put({ id: supplier.id, supplierId: supplier.id, results, checkedAt: now });
  return results;
}

export async function enrollSupplier(
  req: EnrollSupplierRequest,
  opts: { id?: string; createdAt?: string } = {},
): Promise<EnrollSupplierResponse> {
  const repo = getRepo();
  let supplier: Supplier = {
    id: opts.id ?? newId("sup"),
    legalName: req.legalName.trim(),
    domain: req.domain.trim().toLowerCase(),
    address: req.address,
    ...(req.uei ? { uei: req.uei } : {}),
    ...(req.cageCode ? { cageCode: req.cageCode } : {}),
    ...(req.ein ? { ein: req.ein } : {}),
    contactEmail: req.contactEmail,
    claimedUsProduction: req.claimedUsProduction,
    status: "draft",
    createdAt: opts.createdAt ?? nowIso(),
  };
  const checks = await screenSupplier(repo, supplier);
  if (passesEnrollment(checks)) {
    supplier = { ...supplier, status: "enrolled", credentialJwt: await signSupplierCredential(supplier, checks) };
  }
  await repo.suppliers.put(supplier);
  return { supplier, checks };
}

export async function getSupplierDetail(id: string): Promise<SupplierDetailResponse> {
  const repo = getRepo();
  const supplier = await repo.suppliers.get(id);
  if (!supplier) throw notFound("supplier", id);
  const passports = await Promise.all((await repo.passports.list({ supplierId: id })).map((p) => getPassport(p.id)));
  return {
    supplier,
    checks: (await repo.identityChecks.get(id))?.results ?? [],
    passports,
    documents: await repo.documents.list({ supplierId: id }),
  };
}

export async function listSupplierSummaries(): Promise<SupplierSummary[]> {
  const repo = getRepo();
  const [suppliers, pos] = await Promise.all([repo.suppliers.list(), repo.purchaseOrders.list()]);
  return Promise.all(
    suppliers.map(async (supplier) => {
      const latest = pos.filter((p) => p.supplierId === supplier.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1);
      let openFlagCount: number;
      if (latest) {
        const flags = (await repo.flagResults.get(latest.id))?.flags ?? [];
        openFlagCount = flags.filter((f) => f.status === "flag").length;
      } else {
        openFlagCount = ((await repo.identityChecks.get(supplier.id))?.results ?? []).filter((c) => c.status === "flag").length;
      }
      return { supplier, latestDecision: latest?.decision ?? null, openFlagCount };
    }),
  );
}

export async function uploadDocument(
  supplierId: string,
  req: UploadDocumentRequest,
  receivedVia: EvidenceDocument["receivedVia"] = "upload",
): Promise<EvidenceDocument> {
  const repo = getRepo();
  if (!(await repo.suppliers.get(supplierId))) throw notFound("supplier", supplierId);
  const out = await extractDocument(req);
  const doc: EvidenceDocument = {
    id: newId("doc"),
    supplierId,
    kind: req.kind,
    filename: req.filename,
    sha256: out.sha256,
    extracted: out.extracted,
    metadata: { ...out.metadata, extractedBy: out.source },
    receivedVia,
    receivedAt: nowIso(),
  };
  return repo.documents.put(doc);
}
