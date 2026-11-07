import type { PurchaseOrderDetail } from "@/contracts";
import { handle } from "@/server/http";
import { getPurchaseOrderDetail } from "@/server/services/purchaseOrders";

/** Live store data: never prerender or cache. */
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(req, async (): Promise<PurchaseOrderDetail> => getPurchaseOrderDetail((await params).id));
}
