import type { DemoRunResponse, PartPassport, TamperRequest, TamperResponse } from "@/contracts";
import { kickCases } from "../agent/autopilot";
import { reopenAfterPassportRestore, runToCompletion } from "../agent/machine";
import { signPassport, tamperJwt } from "../crypto/vc";
import { ApiProblem, badRequest, notFound } from "../errors";
import { getRepo } from "../repo";
import { DEMO_META_ID, DEMO_PURCHASE_ORDERS, ensureSeeded } from "../seed";
import { getPassport } from "./passports";
import { createPurchaseOrder } from "./purchaseOrders";

/**
 * Create the three demo POs (A, B, C) and return immediately. The server-side autopilot then drives
 * each case to its decision on its own; nothing else needs to be called.
 */
export async function runDemo(): Promise<DemoRunResponse> {
  await ensureSeeded();
  const repo = getRepo();
  // Idempotent: a second run before a reset would find all evidence already on file, send no Naive
  // requests and (for B) never receive passport v2, so B would wrongly come out approved.
  const prior = (await repo.meta.get(DEMO_META_ID))?.demoRun;
  if (prior?.length) {
    const results = await Promise.all(
      prior.map(async (r) => ({ ...r, decision: (await repo.purchaseOrders.get(r.purchaseOrderId))?.decision ?? "pending" })),
    );
    throw new ApiProblem(409, "demo already ran — reset first", { results });
  }
  const results: DemoRunResponse["results"] = [];
  for (const def of DEMO_PURCHASE_ORDERS) {
    const { label, ...req } = def;
    const { purchaseOrder, agentCase } = await createPurchaseOrder(req);
    results.push({ supplierLabel: label, purchaseOrderId: purchaseOrder.id, caseId: agentCase.id, decision: purchaseOrder.decision });
  }
  const meta = await repo.meta.get(DEMO_META_ID);
  if (meta) await repo.meta.put({ ...meta, demoRun: results.map(({ supplierLabel, purchaseOrderId, caseId }) => ({ supplierLabel, purchaseOrderId, caseId })) });
  await kickCases(results.map((r) => r.caseId));
  return { results };
}

/** Scripts/tests: run the demo synchronously to decisions without the heartbeat. */
export async function runDemoToDecisions(): Promise<DemoRunResponse> {
  const { results } = await runDemo();
  await Promise.all(results.map((r) => runToCompletion(r.caseId)));
  const repo = getRepo();
  return {
    results: await Promise.all(
      results.map(async (r) => ({ ...r, decision: (await repo.purchaseOrders.get(r.purchaseOrderId))?.decision ?? "pending" })),
    ),
  };
}

/**
 * Edit one claim of a passport JWT without re-signing and persist it on the stored passport
 * (demo only; /api/demo/reset restores), so /verify/[passportId] shows the signature failure.
 */
export async function tamperPassport(req: TamperRequest): Promise<TamperResponse> {
  const passport = await getPassport(req.passportId);
  let tamperedJwt: string;
  try {
    tamperedJwt = tamperJwt(passport.jwt, req.path, req.value);
  } catch (err) {
    throw badRequest(err instanceof Error ? err.message : "could not tamper JWT");
  }
  // A no-op edit leaves the signature valid, which would silently fail the demo closer.
  if (tamperedJwt === passport.jwt || subjectValue(passport.jwt, req.path) === JSON.stringify(req.value)) {
    throw badRequest(`value unchanged: ${req.path} is already ${JSON.stringify(req.value)}; pick a different value`);
  }
  const repo = getRepo();
  const stored = await repo.passports.get(passport.id);
  if (stored) {
    const meta = await repo.meta.get(DEMO_META_ID);
    // Keep the first genuine JWT so a repeated tamper can still be restored.
    if (meta && !meta.originalJwts?.[stored.id]) {
      await repo.meta.put({ ...meta, originalJwts: { ...meta.originalJwts, [stored.id]: stored.jwt } });
    }
    await repo.passports.put({ ...stored, jwt: tamperedJwt });
    // Wake the agent so monitoring notices the forged passport promptly (request mode: after() continuation).
    const watching = (await repo.purchaseOrders.list()).filter((po) => po.passportIds.includes(stored.id)).map((po) => po.id);
    const cases = (await repo.cases.list()).filter((c) => watching.includes(c.purchaseOrderId) && c.state === "monitoring");
    if (cases.length) await kickCases(cases.map((c) => c.id));
  }
  return { tamperedJwt };
}

/** JSON of the credentialSubject value at a dot path (undefined if absent). */
function subjectValue(jwt: string, path: string): string | undefined {
  try {
    let cur: unknown = (JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8")) as Record<string, unknown>).credentialSubject;
    for (const k of path.split(".").filter(Boolean)) {
      if (cur === null || typeof cur !== "object" || !Object.hasOwn(cur, k)) return undefined;
      cur = (cur as Record<string, unknown>)[k];
    }
    return cur === undefined ? undefined : JSON.stringify(cur);
  } catch {
    return undefined;
  }
}

/**
 * Undo a tamper on one passport. Uses the saved original; otherwise re-signs the stored claims
 * (Ed25519 + a deterministic payload reproduces the original JWT byte-for-byte). Orders the agent held
 * because of the tamper are re-opened and re-evaluated.
 */
export async function restorePassport(passportId: string): Promise<PartPassport> {
  const repo = getRepo();
  const stored = await repo.passports.get(passportId);
  if (!stored) throw notFound("passport", passportId);
  const meta = await repo.meta.get(DEMO_META_ID);
  const original = meta?.originalJwts?.[passportId] ?? (await signPassport(stored));
  await repo.passports.put({ ...stored, jwt: original });
  if (meta?.originalJwts?.[passportId]) {
    const rest = { ...meta.originalJwts };
    delete rest[passportId];
    await repo.meta.put({ ...meta, originalJwts: rest });
  }
  // Cases held because this passport failed verification go back through the agent (-> re-approved).
  const reopened = await reopenAfterPassportRestore(passportId, new Date().toISOString());
  if (reopened.length) await kickCases(reopened);
  return getPassport(passportId);
}
