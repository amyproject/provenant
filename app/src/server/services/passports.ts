import type { CreatePassportRequest, PartPassport, TestCertificateRef } from "@/contracts";
import { allocateStatusIndex, isRevoked, revokeStatusIndex } from "../crypto/statusList";
import { signPassport } from "../crypto/vc";
import { ApiProblem, badRequest, notFound } from "../errors";
import { getRepo } from "../repo";
import { addDays, newId, nowIso } from "../util/ids";

const round = (x: number, dp = 4) => Math.round(x * 10 ** dp) / 10 ** dp;

/** Share of component cost with US origin (input to the Buy American domestic-content test). */
export function domesticContentRatio(components: CreatePassportRequest["components"]): { total: number; ratio: number } {
  const total = components.reduce((s, c) => s + c.costUsd, 0);
  const us = components.filter((c) => c.countryOfOrigin.toUpperCase() === "US").reduce((s, c) => s + c.costUsd, 0);
  return { total: round(total, 2), ratio: total > 0 ? round(us / total) : 0 };
}

/** Validate, compute domestic content, allocate a status-list index and sign — without storing. */
export async function buildPassport(
  req: CreatePassportRequest,
  opts: { id?: string; issuedAt?: string; testCertificates?: TestCertificateRef[] } = {},
): Promise<PartPassport> {
  const repo = getRepo();
  const supplier = await repo.suppliers.get(req.supplierId);
  if (!supplier) throw notFound("supplier", req.supplierId);
  if (supplier.status === "revoked") throw new ApiProblem(409, `supplier ${supplier.id} is revoked`);

  let version = 1;
  if (req.prevVersionId) {
    const prev = await repo.passports.get(req.prevVersionId);
    if (!prev) throw notFound("previous passport version", req.prevVersionId);
    if (prev.supplierId !== supplier.id) throw badRequest("prevVersionId belongs to a different supplier");
    version = prev.version + 1;
  }

  // Seed only: certificate refs resolved from documents not yet on file (they arrive in a supplier reply).
  const testCertificates: TestCertificateRef[] = opts.testCertificates ? [...opts.testCertificates] : [];
  for (const docId of opts.testCertificates ? [] : req.testCertificateDocumentIds) {
    const doc = await repo.documents.get(docId);
    if (!doc || doc.supplierId !== supplier.id) throw badRequest(`test certificate document ${docId} not found for this supplier`);
    testCertificates.push({
      certNumber: String(doc.extracted.certNumber ?? doc.filename),
      issuer: String(doc.extracted.issuer ?? "unknown issuer"),
      fileSha256: doc.sha256,
    });
  }

  const components = req.components.map((c) => ({ ...c, countryOfOrigin: c.countryOfOrigin.toUpperCase() }));
  const { total, ratio } = domesticContentRatio(components);
  const issuedAt = opts.issuedAt ?? nowIso();
  const unsigned: Omit<PartPassport, "jwt"> = {
    id: opts.id ?? newId("pp"),
    version,
    ...(req.prevVersionId ? { prevVersionId: req.prevVersionId } : {}),
    supplierId: supplier.id,
    facility: supplier.address,
    serialOrBatch: req.serialOrBatch,
    model: req.model,
    spec: req.spec,
    components,
    totalCostUsd: total,
    domesticContentRatio: ratio,
    testCertificates,
    ...(req.firmwareVersion ? { firmwareVersion: req.firmwareVersion } : {}),
    issuedAt,
    expiresAt: addDays(issuedAt, 730),
    statusIndex: await allocateStatusIndex(repo),
    revoked: false,
  };
  return { ...unsigned, jwt: await signPassport(unsigned) };
}

export async function createPassport(req: CreatePassportRequest, opts: { id?: string; issuedAt?: string } = {}): Promise<PartPassport> {
  return getRepo().passports.put(await buildPassport(req, opts));
}

/** Passport row with `revoked` reflecting the live status list. */
export async function getPassport(id: string): Promise<PartPassport> {
  const repo = getRepo();
  const p = await repo.passports.get(id);
  if (!p) throw notFound("passport", id);
  return { ...p, revoked: await isRevoked(repo, p.statusIndex) };
}

export async function revokePassport(id: string): Promise<PartPassport> {
  const repo = getRepo();
  const p = await repo.passports.get(id);
  if (!p) throw notFound("passport", id);
  await revokeStatusIndex(repo, p.statusIndex);
  return repo.passports.put({ ...p, revoked: true });
}
