// Assemble the FlagContext for a purchase order from the store (the only impure part of evaluation).
import type { PartPassport, PurchaseOrder, VerifyResult } from "@/contracts";
import { verifyPassportJwt } from "../crypto/vc";
import { notFound } from "../errors";
import { BANK_CHANGES, ISSUER_SAMPLES, PRICE_BASELINES, PRICE_Z_THRESHOLD, TAG_CHALLENGES } from "../fixtures";
import type { FlagContext } from "../flags";
import type { Repo } from "../repo";

export async function loadPassports(repo: Repo, ids: string[]): Promise<PartPassport[]> {
  return (await Promise.all(ids.map((id) => repo.passports.get(id)))).filter((p): p is PartPassport => p !== null);
}

export async function buildFlagContext(repo: Repo, po: PurchaseOrder, now: string): Promise<FlagContext> {
  const supplier = await repo.suppliers.get(po.supplierId);
  if (!supplier) throw notFound("supplier", po.supplierId);
  const policy = await repo.policies.get(po.buyerPolicyId);
  if (!policy) throw notFound("policy", po.buyerPolicyId);

  const passports = await loadPassports(repo, po.passportIds);
  const verifications: Record<string, VerifyResult> = {};
  const previousVersions: Record<string, PartPassport | undefined> = {};
  for (const p of passports) {
    verifications[p.id] = await verifyPassportJwt(p.jwt, repo);
    if (p.prevVersionId) previousVersions[p.id] = (await repo.passports.get(p.prevVersionId)) ?? undefined;
  }
  const [documents, allPassports, allDocuments, allSuppliers, checks] = await Promise.all([
    repo.documents.list({ supplierId: supplier.id }),
    repo.passports.list(),
    repo.documents.list(),
    repo.suppliers.list(),
    repo.identityChecks.get(supplier.id),
  ]);
  return {
    now,
    po,
    supplier,
    policy,
    passports,
    verifications,
    previousVersions,
    identityChecks: checks?.results ?? [],
    documents,
    allPassports,
    allDocuments,
    allSuppliers,
    issuerSamples: ISSUER_SAMPLES,
    priceBaselines: PRICE_BASELINES,
    priceZThreshold: PRICE_Z_THRESHOLD,
    tagChallenges: TAG_CHALLENGES,
    bankChanges: BANK_CHANGES,
  };
}
