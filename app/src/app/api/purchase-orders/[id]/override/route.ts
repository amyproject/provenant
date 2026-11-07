import type { PurchaseOrderDetail } from "@/contracts";
import { handle, readJson } from "@/server/http";
import { overrideDecision } from "@/server/services/purchaseOrders";
import { OverrideSchema } from "@/server/validation";

/** Human-in-the-loop escape hatch: sets the decision + humanOverride; the agent's signed record is kept. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(req, async (): Promise<PurchaseOrderDetail> => {
    const { id } = await params;
    return overrideDecision(id, await readJson(req, OverrideSchema));
  });
}
