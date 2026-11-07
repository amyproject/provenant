import type {
  CreatePurchaseOrderRequest,
  CreatePurchaseOrderResponse,
  OverrideRequest,
  PurchaseOrder,
  PurchaseOrderDetail,
} from "@/contracts";
import { appendEvent, openCase } from "../agent/machine";
import { badRequest, notFound } from "../errors";
import { getRepo } from "../repo";
import { DEFAULT_POLICY_ID } from "../seed/constants";
import { newId, nowIso } from "../util/ids";

/** Create the PO and open its AgentCase. The agent takes it from there (run / tick / autopilot). */
export async function createPurchaseOrder(req: CreatePurchaseOrderRequest): Promise<CreatePurchaseOrderResponse> {
  const repo = getRepo();
  const supplier = await repo.suppliers.get(req.supplierId);
  if (!supplier) throw notFound("supplier", req.supplierId);
  const policyId = req.buyerPolicyId ?? DEFAULT_POLICY_ID;
  if (!(await repo.policies.get(policyId))) throw notFound("policy", policyId);
  for (const id of req.passportIds) {
    const p = await repo.passports.get(id);
    if (!p) throw notFound("passport", id);
    if (p.supplierId !== supplier.id) throw badRequest(`passport ${id} was not issued by supplier ${supplier.id}`);
  }
  const now = nowIso();
  const purchaseOrder: PurchaseOrder = {
    id: newId("po"),
    buyerPolicyId: policyId,
    supplierId: supplier.id,
    passportIds: req.passportIds,
    riskTier: req.riskTier,
    amountUsd: req.amountUsd,
    ...(req.quotedUnitPriceUsd !== undefined ? { quotedUnitPriceUsd: req.quotedUnitPriceUsd } : {}),
    ...(req.quotedLeadTimeDays !== undefined ? { quotedLeadTimeDays: req.quotedLeadTimeDays } : {}),
    decision: "pending",
    decisionReasons: [],
    createdAt: now,
  };
  await repo.purchaseOrders.put(purchaseOrder);
  const agentCase = await openCase(purchaseOrder, now);
  return { purchaseOrder, agentCase };
}

async function detailFor(po: PurchaseOrder): Promise<PurchaseOrderDetail> {
  const repo = getRepo();
  const supplier = await repo.suppliers.get(po.supplierId);
  if (!supplier) throw notFound("supplier", po.supplierId);
  const [flags, cases] = await Promise.all([repo.flagResults.get(po.id), repo.cases.list({ purchaseOrderId: po.id })]);
  return { purchaseOrder: po, supplier, flags: flags?.flags ?? [], agentCase: cases.at(-1) ?? null };
}

export async function getPurchaseOrderDetail(id: string): Promise<PurchaseOrderDetail> {
  const po = await getRepo().purchaseOrders.get(id);
  if (!po) throw notFound("purchase order", id);
  return detailFor(po);
}

export async function listPurchaseOrderDetails(): Promise<PurchaseOrderDetail[]> {
  const pos = await getRepo().purchaseOrders.list();
  return Promise.all(pos.reverse().map(detailFor));
}

/**
 * Human-in-the-loop escape hatch: set the PO decision to the override and record humanOverride.
 * The agent's own reasons and signed decision record stay untouched (they document what the agent decided).
 */
export async function overrideDecision(id: string, req: OverrideRequest): Promise<PurchaseOrderDetail> {
  const repo = getRepo();
  const po = await repo.purchaseOrders.get(id);
  if (!po) throw notFound("purchase order", id);
  const at = nowIso();
  const updated: PurchaseOrder = { ...po, decision: req.decision, humanOverride: { decision: req.decision, reason: req.reason, at } };
  await repo.purchaseOrders.put(updated);

  const agentCase = (await repo.cases.list({ purchaseOrderId: po.id })).at(-1);
  if (agentCase) {
    await appendEvent({
      caseId: agentCase.id,
      at,
      state: agentCase.state,
      actor: "human",
      summary: `Buyer override: PO ${po.id} ${req.decision.toUpperCase()} (was ${po.decision}). Reason: ${req.reason}`,
      detail: { previousDecision: po.decision, decision: req.decision },
    });
    await repo.cases.put({ ...agentCase, decision: req.decision, state: req.decision === "approved" ? "monitoring" : "closed", updatedAt: at });
  }
  return detailFor(updated);
}
