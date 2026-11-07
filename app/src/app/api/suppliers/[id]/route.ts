import type { SupplierDetailResponse } from "@/contracts";
import { handle } from "@/server/http";
import { getSupplierDetail } from "@/server/services/suppliers";

/** Live store data: never prerender or cache. */
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(req, async (): Promise<SupplierDetailResponse> => getSupplierDetail((await params).id));
}
