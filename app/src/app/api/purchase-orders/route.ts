import type { CreatePurchaseOrderResponse, PurchaseOrderDetail } from "@/contracts";
import { kickCase } from "@/server/agent/autopilot";
import { handle, readJson } from "@/server/http";
import { createPurchaseOrder, listPurchaseOrderDetails } from "@/server/services/purchaseOrders";
import { CreatePurchaseOrderSchema } from "@/server/validation";

/** Live store data: never prerender or cache. */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(req, async (): Promise<PurchaseOrderDetail[]> => listPurchaseOrderDetails());
}

/** Create a PO; its AgentCase opens automatically and the autopilot picks it up. */
export async function POST(req: Request) {
  return handle(req, async (): Promise<CreatePurchaseOrderResponse> => {
    const out = await createPurchaseOrder(await readJson(req, CreatePurchaseOrderSchema));
    await kickCase(out.agentCase.id);
    return out;
  }, 201);
}
